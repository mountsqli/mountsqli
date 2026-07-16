import { createTableSQL, type TableDef, type ColumnType } from "@mountsqli/schema";
import type { Driver, Transaction, ExecuteMode, QueryResult, Compiled } from "@mountsqli/driver";
import { MountError, registerDriver } from "@mountsqli/driver";
import { compilePlan, mysqlDialect } from "@mountsqli/compiler";

export interface MysqlConfig {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** Inject a pre-built pool (used in tests / serverless). */
  pool?: MysqlPoolLike;
}

export interface MysqlExecuteResult {
  affectedRows: number;
  insertId: number | bigint;
  rows?: any[];
}

export interface MysqlConnectionLike {
  execute(sql: string, params?: unknown[]): Promise<MysqlExecuteResult>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface MysqlPoolLike {
  execute(sql: string, params?: unknown[]): Promise<MysqlExecuteResult>;
  getConnection(): Promise<MysqlConnectionLike>;
  end(): Promise<void>;
}

// Real `mysql2` Pool is loaded lazily so the package can be imported (and
// tested with a fake pool) without the dependency present at runtime.
type Mysql2Module = { createPool(cfg: any): MysqlPoolLike };

async function loadMysql2(): Promise<Mysql2Module> {
  const mod = (await import("mysql2/promise")) as unknown as Mysql2Module;
  if (!mod || typeof mod.createPool !== "function") {
    throw new MountError("CONFIG", "MountSQLI: failed to load mysql2/promise. Install it with: npm i mysql2");
  }
  return mod;
}

/** Classify connection-level MySQL errors. */
function classifyMysqlError(err: Error, cfg: MysqlConfig): MountError {
  const msg = err.message;
  if (msg.includes("ECONNREFUSED") || msg.includes("connect ECONNREFUSED")) {
    return new MountError("CONNECTION",
      `MountSQLI: cannot reach MySQL server at ${cfg.host ?? "localhost"}:${cfg.port ?? 3306}. Is the server running?`,
    );
  }
  if (msg.includes("ER_ACCESS_DENIED")) {
    return new MountError("CONNECTION",
      `MountSQLI: MySQL authentication failed for user "${cfg.user ?? "root"}". Check username and password.`,
    );
  }
  if (msg.includes("ER_BAD_DB_ERROR") || (msg.includes("Unknown database"))) {
    return new MountError("CONNECTION",
      `MountSQLI: MySQL database "${cfg.database ?? "test"}" does not exist. Create it first.`,
    );
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) {
    return new MountError("CONNECTION",
      "MountSQLI: MySQL connection timed out. Check network and server load.",
    );
  }
  return new MountError("CONNECTION", "MountSQLI: MySQL connection failed", { detail: msg });
}

/** Classify query-level MySQL errors. */
function classifyMysqlQueryError(err: Error): MountError {
  const msg = err.message;
  // Duplicate entry (unique constraint)
  if (msg.includes("Duplicate entry") || msg.includes("ER_DUP_ENTRY")) {
    return new MountError("CONFLICT",
      "MountSQLI: duplicate value violates a unique constraint.",
      { detail: msg },
    );
  }
  // Foreign key violation
  if (msg.includes("foreign key constraint") || msg.includes("Cannot add or update a child row")) {
    return new MountError("VALIDATION",
      "MountSQLI: value does not exist in the referenced table (foreign key violation).",
      { detail: msg },
    );
  }
  // NOT NULL violation
  if (msg.includes("cannot be null") || msg.includes("Column") && msg.includes("cannot be null")) {
    return new MountError("VALIDATION",
      "MountSQLI: a required column was not provided.",
      { detail: msg },
    );
  }
  // Data truncation / wrong type
  if (msg.includes("Data too long") || msg.includes("Incorrect integer") || msg.includes("Incorrect value")) {
    return new MountError("VALIDATION",
      "MountSQLI: invalid value — check that the value matches the column type.",
      { detail: msg },
    );
  }
  // Table/column does not exist
  if (msg.includes("doesn't exist") || msg.includes("Unknown column")) {
    return new MountError("QUERY_FAILED",
      "MountSQLI: query references a table or column that does not exist.",
      { detail: msg },
    );
  }
  // Syntax error
  if (msg.includes("syntax error") || msg.includes("You have an error in your SQL")) {
    return new MountError("QUERY_FAILED",
      "MountSQLI: query failed — check the query structure.",
      { detail: msg },
    );
  }
  // Fallback
  return new MountError("QUERY_FAILED", "MountSQLI: query failed", { detail: msg });
}

function validateMysqlConfig(cfg: MysqlConfig): void {
  if (!cfg.url && !cfg.host && !cfg.pool) {
    throw new MountError("CONNECTION",
      "MountSQLI: missing MySQL connection config. Set DATABASE_URL or provide host/database.",
    );
  }
}

function buildCfg(cfg: MysqlConfig): Record<string, unknown> {
  return {
    host: cfg.host ?? "localhost",
    port: cfg.port ?? 3306,
    user: cfg.user ?? "root",
    password: cfg.password ?? "",
    database: cfg.database ?? "test",
    waitForConnections: true,
    connectionLimit: 10,
  };
}

export function resolveUrl(url: string): MysqlConfig {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
    };
  } catch {
    return {};
  }
}

export class MysqlDriver implements Driver {

  readonly name = "mysql";
  readonly ready: Promise<void> = Promise.resolve();
  private pool: MysqlPoolLike;
  private prepared = new Map<string, string>();
  private cfg: MysqlConfig;

  constructor(cfg: MysqlConfig) {
    validateMysqlConfig(cfg);
    this.cfg = cfg;
    const merged = cfg.url ? { ...resolveUrl(cfg.url), ...cfg } : cfg;
    this.pool =
      merged.pool ??
      (() => {
        let created: MysqlPoolLike | undefined;
        let initError: Error | undefined;
        const get = async (): Promise<MysqlPoolLike> => {
          if (initError) throw new MountError("CONFIG", `MountSQLI: mysql2/promise is not available — install it with "npm i mysql2".`);
          if (!created) {
            try {
              created = (await loadMysql2()).createPool(buildCfg(merged));
            } catch (e) {
              initError = e as Error;
              throw new MountError("CONFIG", `MountSQLI: mysql2/promise is not available — install it with "npm i mysql2".`);
            }
          }
          return created;
        };
        return {
          execute: (sql, params) => get().then((p) => p.execute(sql, params)),
          getConnection: () => get().then((p) => p.getConnection()),
          end: async () => {
            if (created) await created.end();
          },
        } satisfies MysqlPoolLike;
      })();
  }

  async init(tables: TableDef[]): Promise<void> {
    // Verify connection is alive before creating tables
    try {
      await this.ping();
    } catch (e) {
      // On first connect, map auth/refusal errors before table init begins
      const merged = this.cfg.url ? { ...resolveUrl(this.cfg.url), ...this.cfg } : this.cfg;
      throw classifyMysqlError(e as Error, merged);
    }
    const q = (id: string) => `\`${id.replace(/`/g, "``")}\``;
    for (const t of tables) {
      // Step 1: Create table if not exists (or add columns from schema).
      try {
        await this.pool.execute(createTableSQL(t, (c: ColumnType) => mysqlDialect.typeName(c), "AUTO_INCREMENT", q));
      } catch (e) {
        const merged = this.cfg.url ? { ...resolveUrl(this.cfg.url), ...this.cfg } : this.cfg;
        throw classifyMysqlError(e as Error, merged);
      }

      // Step 2: Fetch existing column metadata.
      const descRes = await this.pool.execute(`DESCRIBE ${q(t.name)}`);
      const rawRows = Array.isArray(descRes) ? descRes[0] : (descRes as any).rows ?? [];
      const colMap = new Map((rawRows as any[]).map((r: any) => [r.Field, r]));

      // Step 3: Add missing columns from schema.
      for (const col of t.columns) {
        if (!colMap.has(col.name)) {
          const sqlType = mysqlDialect.typeName(col.type);
          let ddl = `ALTER TABLE ${q(t.name)} ADD COLUMN ${q(col.name)} ${sqlType}`;
          if (col.default !== undefined) ddl += ` DEFAULT ${this.formatMysqlDefault(col.default)}`;
          await this.pool.execute(ddl);
        } else if (col.primaryKey && col.type === "int") {
          // Ensure int PK has AUTO_INCREMENT.
          const existing = colMap.get(col.name) as any;
          if (!String(existing.Extra ?? "").toUpperCase().includes("AUTO_INCREMENT")) {
            try {
              await this.pool.execute(`ALTER TABLE ${q(t.name)} MODIFY COLUMN ${q(col.name)} ${mysqlDialect.typeName(col.type)} AUTO_INCREMENT`);
            } catch {
              // FK constraint — find and drop dependent FKs, retry.
              const fkRes = await this.pool.execute(
                `SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME = ? AND REFERENCED_COLUMN_NAME = ?`,
                [t.name, col.name],
              );
              const fkRows = Array.isArray(fkRes) ? fkRes[0] : (fkRes as any).rows ?? [];
              for (const fk of fkRows as any[]) {
                try {
                  await this.pool.execute(`ALTER TABLE \`${fk.TABLE_NAME}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
                } catch { /* table may have been dropped */ }
              }
              await this.pool.execute(`ALTER TABLE ${q(t.name)} MODIFY COLUMN ${q(col.name)} ${mysqlDialect.typeName(col.type)} AUTO_INCREMENT`);
            }
          }
        }
      }

      // Step 4: Add defaults to NOT NULL columns that lack them (e.g. `created_at`
      // from a previous schema that's NOT NULL but has no default).
      for (const [colName, info] of colMap) {
        const info_ = info as any;
        if (info_.Null === "NO" && !info_.Default && !info_.Extra?.toUpperCase().includes("AUTO_INCREMENT")) {
          if (String(info_.Type).toUpperCase().includes("TIMESTAMP") || String(info_.Type).toUpperCase().includes("DATE")) {
            await this.pool.execute(`ALTER TABLE ${q(t.name)} ALTER COLUMN ${q(colName)} SET DEFAULT CURRENT_TIMESTAMP`);
          } else if (String(info_.Type).toUpperCase().includes("INT")) {
            await this.pool.execute(`ALTER TABLE ${q(t.name)} ALTER COLUMN ${q(colName)} SET DEFAULT 0`);
          } else if (String(info_.Type).toUpperCase().includes("TINYINT")) {
            await this.pool.execute(`ALTER TABLE ${q(t.name)} ALTER COLUMN ${q(colName)} SET DEFAULT 0`);
          } else {
            await this.pool.execute(`ALTER TABLE ${q(t.name)} ALTER COLUMN ${q(colName)} SET DEFAULT ''`);
          }
        }
      }
    }
  }

  private formatMysqlDefault(value: unknown): string {
    if (typeof value === "string") {
      if (/^[A-Z_][A-Z0-9_]*$/.test(value) || /^[A-Z_][A-Z0-9_]*\(.*\)$/.test(value)) return value;
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === "boolean") return value ? "1" : "0";
    return String(value);
  }

  // MySQL already uses `?`, so the compiled placeholder is passed through
  // unchanged. We convert double-quoted identifiers to backtick-quoted since
  // MySQL only supports double-quote identifiers in ANSI_QUOTES mode.
  private mysqlSql(compiled: Compiled): string {
    const cached = this.prepared.get(compiled.sql);
    if (cached) return cached;
    const converted = compiled.sql.replace(/"([^"]+)"/g, (_m, id) => `\`${id.replace(/`/g, "``")}\``);
    this.prepared.set(compiled.sql, converted);
    return converted;
  }

  private bind(value: unknown): unknown {
    if (value instanceof Date) return value;
    if (typeof value === "boolean") return value ? 1 : 0; // TINYINT(1)
    return value;
  }

  // mysql2 returns TINYINT(1) as a number (0/1); coerce back to boolean
  // when the plan says the column is a `bool`.
  private decode<R extends Record<string, any>>(rows: R[], types?: Record<string, string>): R[] {
    if (!types) return rows;
    return rows.map((row) => {
      const out: any = { ...row };
      for (const col of Object.keys(types)) {
        if (types[col] === "bool" && col in out) out[col] = out[col] === 1 || out[col] === true;
      }
      return out as R;
    });
  }

  private mergedCfg(): MysqlConfig {
    return this.cfg.url ? { ...resolveUrl(this.cfg.url), ...this.cfg } : this.cfg;
  }

  async query<T = any>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>> {
    const sql = this.mysqlSql(compiled);
    const params = compiled.params.map((p) => this.bind(p));
    if (mode === "run") {
      let res: MysqlExecuteResult;
      try {
        res = await this.pool.execute(sql, params);
      } catch (e) {
        throw classifyMysqlQueryError(e as Error);
      }
      const id = res.insertId;
      let insertedRow: T | undefined;

      // RETURNING emulation: when compilePlan set `returning` but the dialect
      // doesn't support it natively, fetch the inserted row back.
      if (compiled.returning?.length && res.affectedRows > 0 && compiled.table) {
        const pkCol = "id"; // common case; could be configurable
        const qFn = (col: string) => `\`${col.replace(/`/g, "``")}\``;
        const cols = compiled.returning.map(qFn).join(", ");
        try {
          const lastId = typeof id === "bigint" ? Number(id) : Number(id ?? 0);
          if (lastId > 0) {
            const sel = await this.pool.execute(`SELECT ${cols} FROM ${qFn(compiled.table)} WHERE ${qFn(pkCol)} = ?`, [lastId]);
            const selRows = Array.isArray(sel) ? sel[0] : (sel as any).rows ?? [];
            if (selRows.length) insertedRow = selRows[0] as T;
          }
        } catch { /* best-effort — RETURNING emulation may fail if PK isn't "id" */ }
      }

      return {
        rows: insertedRow ? [insertedRow] : [],
        changes: res.affectedRows ?? 0,
        lastId: typeof id === "bigint" ? Number(id) : (id as number) ?? 0,
        insertedRow,
      };
    }
    let res: MysqlExecuteResult;
    try {
      res = await this.pool.execute(sql, params);
    } catch (e) {
      throw classifyMysqlQueryError(e as Error);
    }
    const raw = Array.isArray(res) ? res[0] : res.rows;
    const rows = this.decode((raw ?? []) as Record<string, any>[], compiled.columnTypes);
    if (mode === "one") return { rows: rows.slice(0, 1) as T[], changes: 0, lastId: 0 } as any;
    return { rows: rows as T[], changes: 0, lastId: 0 } as any;
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    let conn: MysqlConnectionLike;
    try {
      conn = await this.pool.getConnection();
    } catch (e) {
      throw classifyMysqlError(e as Error, this.mergedCfg());
    }
    await conn.beginTransaction();
    try {
      const tx: Transaction = {
        query: async (c, mode) => {
          const sql = this.mysqlSql(c);
          const params = c.params.map((p) => this.bind(p));
          let res: MysqlExecuteResult;
          try {
            res = await conn.execute(sql, params);
          } catch (e) {
            throw classifyMysqlQueryError(e as Error);
          }
          const id = res.insertId;

          let insertedRow: any;
          if (mode === "run" && c.returning?.length && res.affectedRows > 0 && c.table) {
            const pkCol = "id";
            const qFn = (col: string) => `\`${col.replace(/`/g, "``")}\``;
            const cols = c.returning.map(qFn).join(", ");
            try {
              const lastId = typeof id === "bigint" ? Number(id) : Number(id ?? 0);
              if (lastId > 0) {
                const sel = await conn.execute(`SELECT ${cols} FROM ${qFn(c.table)} WHERE ${qFn(pkCol)} = ?`, [lastId]);
                const selRows = Array.isArray(sel) ? sel[0] : (sel as any).rows ?? [];
                if (selRows.length) insertedRow = selRows[0];
              }
            } catch { /* best-effort */ }
          }

          return {
            rows: insertedRow ? [insertedRow] : (res.rows ?? []) as any[],
            changes: res.affectedRows ?? 0,
            lastId: typeof id === "bigint" ? Number(id) : (id as number) ?? 0,
            insertedRow,
          } as any;
        },
        commit: () => conn.commit(),
        rollback: () => conn.rollback(),
        savepoint: async (name) => { await conn.execute(`SAVEPOINT \`${name}\``); },
        rollbackTo: async (name) => { await conn.execute(`ROLLBACK TO SAVEPOINT \`${name}\``); },
        release: async (name) => { await conn.execute(`RELEASE SAVEPOINT \`${name}\``); },
      };
      const r = await fn(tx);
      await conn.commit();
      return r;
    } catch (e) {
      try { await conn.rollback(); } catch { /* best-effort */ }
      if (e instanceof MountError) throw e;
      throw classifyMysqlQueryError(e as Error);
    } finally {
      try { conn.release(); } catch { /* may have been released */ }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.execute("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}

registerDriver("mysql", () => new MysqlDriver({ url: process.env.DATABASE_URL }));
registerDriver("mysql2", () => new MysqlDriver({ url: process.env.DATABASE_URL }));
