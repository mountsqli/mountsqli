// MountSQLI — PostgreSQL driver (built on `pg`).
// Demonstrates the multi-driver design: it implements the same `Driver`
// contract as the SQLite driver, but compiles plans against the
// `postgresDialect` (numbered $1/$2 params, BOOLEAN/JSONB/TIMESTAMPTZ types)
// and adapts node value types to the wire format pg expects.

import pkg from "pg";
const { Pool } = pkg;

import { compilePlan, postgresDialect, type Compiled } from "@mountsqli/compiler";
import type { Driver, ExecuteMode, QueryResult, Transaction } from "@mountsqli/driver";
import { MountError, registerDriver, traceSpan } from "@mountsqli/driver";
import { createTableSQL, type TableDef, type ColumnType } from "@mountsqli/schema";

export interface PostgresConfig {
  url?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  /** SSL/TLS config — pass `true` for required TLS, or an object with `ca`, `cert`, `key` etc. */
  ssl?: boolean | Record<string, unknown>;
  /** Maximum pool size (default 10). */
  poolSize?: number;
  /** Maximum connection retries (default 3). */
  maxRetries?: number;
  /** Inject a pre-built pool (used in tests / serverless). */
  pool?: typeof Pool.prototype;
}

export function buildPgConfig(cfg: PostgresConfig): Record<string, unknown> {
  let base: Record<string, unknown>;
  if (cfg.url) {
    // When passing connectionString, pg parses the URL itself. If the URL
    // has no password (e.g. postgres://localhost/... without user:pass@),
    // pg leaves password undefined, causing SASL/SCRAM auth errors with
    // "client password must be a string". Parse the URL to ensure password
    // is always a string when omitted.
    try {
      const u = new URL(cfg.url);
      if (!u.password) {
        // Spread host/user/password/database separately so pg gets a
        // defined password instead of passing through the undefined
        // field from the parsed connectionString.
        base = {
          host: u.hostname || "localhost",
          port: Number(u.port) || 5432,
          user: decodeURIComponent(u.username) || "postgres",
          password: "",
          database: (u.pathname || "/postgres").replace(/^\//, "") || "postgres",
        };
      } else {
        base = { connectionString: cfg.url };
      }
    } catch {
      base = { connectionString: cfg.url };
    }
  } else {
    base = { host: cfg.host ?? "localhost", port: cfg.port ?? 5432, user: cfg.user ?? "postgres", password: cfg.password ?? "", database: cfg.database ?? "postgres" };
  }
  if (cfg.ssl !== undefined) base.ssl = cfg.ssl;
  if (cfg.poolSize !== undefined) base.max = cfg.poolSize;
  return base;
}

/** Validate pg config before connecting — catches missing credentials early. */
function validatePgConfig(cfg: PostgresConfig): void {
  if (!cfg.url && !cfg.host && !cfg.database && !cfg.pool) {
    throw new MountError("CONNECTION",
      "MountSQLI: missing Postgres connection config. Set DATABASE_URL or provide host/database.",
    );
  }
  if (cfg.maxRetries !== undefined && (cfg.maxRetries < 0 || cfg.maxRetries > 20)) {
    throw new MountError("CONFIG",
      "MountSQLI: maxRetries must be between 0 and 20.",
    );
  }
}

/** Map common pg connection errors to human-readable MountError messages. */
function classifyPgError(err: Error, url?: string): MountError {
  const msg = err.message;
  if (msg.includes("password must be a string") || msg.includes("SASL") || msg.includes("SCRAM")) {
    return new MountError("CONNECTION",
      `MountSQLI: Postgres authentication failed for "${url ?? "default"}". ` +
      `Provide a username and password in DATABASE_URL (postgres://user:pass@host/db).`,
      { hint: "Set DATABASE_URL=postgres://myuser:mypass@localhost:5432/mydb" },
    );
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("connect ECONNREFUSED")) {
    return new MountError("CONNECTION",
      `MountSQLI: cannot reach Postgres server at "${url ?? "localhost:5432"}". ` +
      "Is the server running? Check `pg_isready` or the DATABASE_URL.",
    );
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("timeout")) {
    return new MountError("CONNECTION",
      "MountSQLI: Postgres connection timed out. Check network and server load.",
    );
  }
  if (msg.includes("database") && (msg.includes("does not exist") || msg.includes("not exist"))) {
    const db = url ? new URL(url).pathname.replace(/^\//, "") : "unknown";
    return new MountError("CONNECTION",
      `MountSQLI: Postgres database "${db}" does not exist. Create it with: createdb ${db}`,
    );
  }
  if (msg.includes("role") && msg.includes("does not exist")) {
    return new MountError("CONNECTION",
      "MountSQLI: Postgres role (user) does not exist. Use CREATE ROLE or set a different user in DATABASE_URL.",
    );
  }
  if (msg.includes("no pg_hba.conf entry")) {
    return new MountError("CONNECTION",
      "MountSQLI: Postgres rejected connection (no pg_hba.conf entry). Check authentication method in pg_hba.conf.",
    );
  }
  // Fallback — generic connection error, raw detail in `details`
  return new MountError("CONNECTION", "MountSQLI: Postgres connection failed", { detail: msg });
}

/** Classify query-level PG errors (invalid syntax, constraint violations, etc). */
function classifyPgQueryError(err: Error): MountError {
  const msg = err.message;
  if (msg.includes("invalid input syntax")) {
    return new MountError("NOT_FOUND",
      "Resource not found — the provided identifier does not match any record.",
      { detail: msg },
    );
  }
  if (msg.includes("unique constraint") || msg.includes("duplicate key")) {
    return new MountError("CONFLICT",
      "MountSQLI: duplicate value violates a unique constraint.",
      { detail: msg },
    );
  }
  if (msg.includes("violates foreign key constraint")) {
    return new MountError("VALIDATION",
      "MountSQLI: value does not exist in the referenced table (foreign key violation).",
      { detail: msg },
    );
  }
  if (msg.includes("not null") || msg.includes("null value in column")) {
    return new MountError("VALIDATION",
      "MountSQLI: a required column was not provided.",
      { detail: msg },
    );
  }
  if (msg.includes("syntax error") || msg.includes("does not exist")) {
    return new MountError("QUERY_FAILED",
      "MountSQLI: query failed — check the query structure.",
      { detail: msg },
    );
  }
  // Fallback — safe generic message, raw detail in `details`
  return new MountError("QUERY_FAILED", "MountSQLI: query failed", { detail: msg });
}

export class PostgresDriver implements Driver {
  readonly name = "postgres";
  readonly ready: Promise<void>;
  private pool: any;
  private prepared = new Map<string, string>(); // normalized sql -> pg sql

  constructor(private cfg: PostgresConfig) {
    validatePgConfig(cfg);
    try {
      this.pool = cfg.pool ?? new Pool(buildPgConfig(cfg));
    } catch (e) {
      throw classifyPgError(e as Error, cfg.url);
    }
    this.ready = Promise.resolve();
  }

  async init(tables: TableDef[]): Promise<void> {
    const maxRetries = this.cfg.maxRetries ?? 3;
    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let client: any;
      try {
        client = await this.pool.connect();
      } catch (e) {
        lastErr = e as Error;
        if (attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
          await new Promise((r) => setTimeout(r, delay));
        }
        continue;
      }
      try {
        for (const t of tables) {
          await client.query(createTableSQL(t, (c) => postgresDialect.typeName(c)));
          const tableInfo = await client.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
            [t.name],
          );
          const existingCols = new Set(tableInfo.rows.map((r: any) => r.column_name));
          for (const col of t.columns) {
            if (!existingCols.has(col.name)) {
              const sqlType = postgresDialect.typeName(col.type);
              const qCol = `"${col.name.replace(/"/g, '""')}"`;
              let ddl = `ALTER TABLE "${t.name.replace(/"/g, '""')}" ADD COLUMN ${qCol} ${sqlType}`;
              if (col.default !== undefined) ddl += ` DEFAULT ${this.formatPgDefault(col.default)}`;
              await client.query(ddl);
            }
          }
        }
        lastErr = undefined;
        break; // success — exit retry loop
      } catch (e) {
        lastErr = e as Error;
        if (attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
          await new Promise((r) => setTimeout(r, delay));
        }
      } finally {
        try { client.release(); } catch { /* best-effort */ }
      }
    }
    if (lastErr) {
      const msg = lastErr.message;
      if (msg.includes("password") || msg.includes("SASL") || msg.includes("SCRAM") ||
          msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") ||
          msg.includes("does not exist")) {
        throw classifyPgError(lastErr, this.cfg.url);
      }
      throw classifyPgQueryError(lastErr);
    }
  }

  private formatPgDefault(value: unknown): string {
    if (typeof value === "string") {
      // SQL keywords (CURRENT_TIMESTAMP, TRUE, FALSE) are all-uppercase.
      // SQL function calls (gen_random_uuid(), now()) have parentheses.
      if (/^[A-Z_][A-Z0-9_]*$/.test(value)) return value;
      if (/^[a-zA-Z_][a-zA-Z0-9_]*\(.*\)$/.test(value)) return value;
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return String(value);
  }

  private pgSql(compiled: Compiled): string {
    const cached = this.prepared.get(compiled.sql);
    if (cached) return cached;
    // compiled.sql already uses ? for sqlite; rewrite to $1..$n for pg.
    let i = 0;
    const out = compiled.sql.replace(/\?/g, () => `$${++i}`);
    this.prepared.set(compiled.sql, out);
    return out;
  }

  private bind(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "boolean") return value; // pg accepts native bool
    return value;
  }

  /**
   * Get a client from the pool. Each `query()` call takes and releases its own
   * client — no shared single-connection field (that design leaked connections
   * under concurrency; see issue 002).
   */
  private async getClient(): Promise<any> {
    return this.pool.connect();
  }

  /** Release a client back to the pool. */
  private releaseClient(client: any): void {
    client.release();
  }

  /**
   * Borrow a client for multiple operations (request-scope reuse).
   * Returns a self-contained handle whose `query`/`release` only touch its own
   * client — never the driver's shared state — so concurrent borrows are
   * isolated (issue 002).
   */
  async borrow(): Promise<{
    query: <T = any>(compiled: Compiled, mode: ExecuteMode) => Promise<QueryResult<T>>;
    release: () => Promise<void>;
  }> {
    const client = await this.pool.connect();
    let released = false;
    return {
      query: async <T = any>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>> => {
        const sql = this.pgSql(compiled);
        const params = compiled.params.map((p) => this.bind(p));
        try {
          const res = await client.query(sql, params);
          if (mode === "run") {
            const rows = (res.rows ?? []) as T[];
            return { rows, changes: res.rowCount ?? 0, lastId: 0 };
          }
          const rows = res.rows as T[];
          return { rows: mode === "one" ? rows.slice(0, 1) : rows, changes: 0, lastId: 0 };
        } catch (e) {
          throw classifyPgQueryError(e as Error);
        }
      },
      release: async () => {
        if (released) return;
        released = true;
        client.release();
      },
    };
  }

  async query<T = any>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>> {
    return traceSpan("driver.query", { "db.system": "postgres", "db.statement": compiled.sql, "db.mode": mode }, async () => {
      const sql = this.pgSql(compiled);
      const params = compiled.params.map((p) => this.bind(p));
      const client = await this.getClient();
      try {
        const res = await client.query(sql, params);
        if (mode === "run") {
          // Postgres supports RETURNING natively — when returning columns are set,
          // res.rows contains the returned rows even for INSERT/UPDATE/DELETE.
          const rows = (res.rows ?? []) as T[];
          return { rows, changes: res.rowCount ?? 0, lastId: 0 };
        }
        const rows = res.rows as T[];
        return { rows: mode === "one" ? rows.slice(0, 1) : rows, changes: 0, lastId: 0 };
      } catch (e) {
        throw classifyPgQueryError(e as Error);
      } finally {
        this.releaseClient(client);
      }
    });
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    let client: any;
    try {
      client = await this.pool.connect();
    } catch (e) {
      throw classifyPgError(e as Error, this.cfg.url);
    }
    await client.query("BEGIN");
    const tx: Transaction = {
      query: async (compiled, mode) => {
        const sql = this.pgSql(compiled);
        const params = compiled.params.map((p) => this.bind(p));
        try {
          const res = await client.query(sql, params);
          if (mode === "run") return { rows: (res.rows ?? []) as any[], changes: res.rowCount ?? 0, lastId: 0 };
          const rows = res.rows as any[];
          return { rows: mode === "one" ? rows.slice(0, 1) : rows, changes: 0, lastId: 0 };
        } catch (e) {
          throw classifyPgQueryError(e as Error);
        }
      },
      commit: async () => {
        try {
          await client.query("COMMIT");
        } catch (e) {
          throw classifyPgQueryError(e as Error);
        }
      },
      rollback: async () => {
        try {
          await client.query("ROLLBACK");
        } catch { /* best-effort — connection may be dead */ }
      },
      savepoint: async (name) => { await client.query(`SAVEPOINT "${name}"`); },
      rollbackTo: async (name) => { await client.query(`ROLLBACK TO SAVEPOINT "${name}"`); },
      release: async (name) => { await client.query(`RELEASE SAVEPOINT "${name}"`); },
    };
    try {
      const out = await fn(tx);
      await tx.commit();
      return out;
    } catch (e) {
      try { await tx.rollback(); } catch { /* best-effort */ }
      // If already wrapped by the tx query handler, keep it; otherwise wrap.
      if (e instanceof MountError) throw e;
      throw classifyPgQueryError(e as Error);
    } finally {
      try { client.release(); } catch { /* best-effort */ }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async ping(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query("SELECT 1");
        return true;
      } finally {
        client.release();
      }
    } catch {
      return false;
    }
  }
}

// Register under a stable name so `mount({ driver: "postgres" })` works.
registerDriver("postgres", () => new PostgresDriver({ url: process.env.DATABASE_URL }));
registerDriver("pg", () => new PostgresDriver({ url: process.env.DATABASE_URL }));
