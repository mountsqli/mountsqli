// MountSQLI — Node.js SQLite driver (zero dependencies).

/**
 * Parse a SQLite connection URL into a file path.
 * "sqlite::memory:" → ":memory:"
 * "sqlite:///data/db.sqlite" → "/data/db.sqlite"
 * "file:data.db" → "data.db"
 * "data.db" → "data.db"
 */
export function resolveSqliteUrl(url: string): string {
  if (url === ":memory:" || url === "sqlite::memory:") return ":memory:";
  try {
    const u = new URL(url);
    // sqlite:///path/to/db → /path/to/db
    if (u.protocol === "sqlite:" || u.protocol === "file:") {
      return u.pathname;
    }
  } catch { /* not a URL, plain file path */ }
  return url;
}

// Uses the built-in `node:sqlite` module (Node >= 22.5). This proves the
// end-to-end shape with no native build step. Positional `?` params map
// directly to node:sqlite's prepared statements.

import { DatabaseSync } from "node:sqlite";

import { compilePlan, sqliteDialect, type Compiled } from "@mountsqli/compiler";
import type { Driver, ExecuteMode, QueryResult, Transaction } from "@mountsqli/driver";
import { MountError, registerDriver, traceSpan } from "@mountsqli/driver";
import { createTableSQL, type TableDef, type ColumnType } from "@mountsqli/schema";

function classifySqliteError(err: Error, url: string): MountError {
  const msg = err.message;
  if (msg.includes("unable to open database") || msg.includes("cannot open") || msg.includes("disk I/O")) {
    return new MountError("CONNECTION",
      `MountSQLI: cannot open SQLite database at "${url}". Check that the path exists and is writable.`,
    );
  }
  return classifySqliteQueryError(err);
}

/** Classify query-level SQLite errors. */
function classifySqliteQueryError(err: Error): MountError {
  const msg = err.message;

  // UNIQUE constraint violation
  if (msg.includes("UNIQUE constraint failed")) {
    return new MountError("CONFLICT",
      "MountSQLI: duplicate value violates a unique constraint.",
      { detail: msg },
    );
  }

  // FOREIGN KEY constraint violation
  if (msg.includes("FOREIGN KEY constraint failed")) {
    return new MountError("VALIDATION",
      "MountSQLI: value does not exist in the referenced table (foreign key violation).",
      { detail: msg },
    );
  }

  // NOT NULL constraint violation
  if (msg.includes("NOT NULL constraint failed") || msg.includes("may not be NULL")) {
    return new MountError("VALIDATION",
      "MountSQLI: a required column was not provided.",
      { detail: msg },
    );
  }

  // CHECK constraint violation
  if (msg.includes("CHECK constraint failed")) {
    return new MountError("VALIDATION",
      "MountSQLI: a CHECK constraint was violated.",
      { detail: msg },
    );
  }

  // Data type mismatch / wrong type
  if (msg.includes("type mismatch") || msg.includes("datatype mismatch")) {
    return new MountError("VALIDATION",
      "MountSQLI: invalid value type — check that parameter types match the column types.",
      { detail: msg },
    );
  }

  // Fallback
  return new MountError("QUERY_FAILED", "MountSQLI: query failed", { detail: msg });
}

export class NodeSqliteDriver implements Driver {
  readonly name = "sqlite";
  readonly ready: Promise<void>;
  private db: DatabaseSync;
  private prepared = new Map<string, ReturnType<DatabaseSync["prepare"]>>();

  constructor(url: string) {
    try {
      this.db = new DatabaseSync(url);
    } catch (e) {
      throw classifySqliteError(e as Error, url);
    }
    // WAL is meaningless (and breaks rowid reads) on shared :memory: pools.
    if (url !== ":memory:") {
      try { this.db.exec("PRAGMA journal_mode = WAL;"); } catch { /* best-effort */ }
    }
    try { this.db.exec("PRAGMA foreign_keys = ON;"); } catch { /* best-effort */ }
    this.ready = Promise.resolve();
  }

  async init(tables: TableDef[]): Promise<void> {
    for (const t of tables) {
      try {
        this.db.exec(createTableSQL(t, (c: ColumnType) => sqliteDialect.typeName(c)));
      } catch (e) {
        throw classifySqliteError(e as Error, ":memory:");
      }
    }
  }

  private stmt(sql: string) {
    let s = this.prepared.get(sql);
    if (!s) {
      try {
        s = this.db.prepare(sql);
      } catch (e) {
        throw classifySqliteError(e as Error, ":memory:");
      }
      this.prepared.set(sql, s);
    }
    return s;
  }

  // node:sqlite only binds number | string | bigint | Uint8Array | null.
  private bind(value: unknown): unknown {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  // Map raw driver rows back to the inferred TS types (bool 0/1 -> boolean).
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

  async query<T = any>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>> {
    return traceSpan("driver.query", { "db.system": "sqlite", "db.statement": compiled.sql, "db.mode": mode }, async () => {
      const params = compiled.params.map((p) => this.bind(p));
      const stmt = this.stmt(compiled.sql);
      try {
        if (mode === "run") {
          const r = stmt.run(...(params as any[]));
          const id = r.lastInsertRowid;
          return { rows: [], changes: r.changes, lastId: typeof id === "bigint" ? Number(id) : (id as number) } as QueryResult<T>;
        }
        const rows = stmt.all(...(params as any[])) as Record<string, any>[];
        const final = mode === "one" ? rows.slice(0, 1) : rows;
        const decoded = this.decode(final, compiled.columnTypes as Record<string, string> | undefined);
        return { rows: decoded as T[], changes: 0, lastId: 0 };
      } catch (e) {
        throw classifySqliteQueryError(e as Error);
      }
    });
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      this.db.exec("BEGIN");
    } catch (e) {
      throw classifySqliteError(e as Error, ":memory:");
    }
    const tx: Transaction = {
      query: async (compiled, mode) => this.query(compiled, mode),
      commit: async () => this.db.exec("COMMIT"),
      rollback: async () => this.db.exec("ROLLBACK"),
      savepoint: async (name) => this.db.exec(`SAVEPOINT "${name}"`),
      rollbackTo: async (name) => this.db.exec(`ROLLBACK TO SAVEPOINT "${name}"`),
      release: async (name) => this.db.exec(`RELEASE SAVEPOINT "${name}"`),
    };
    try {
      const out = await fn(tx);
      await tx.commit();
      return out;
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  }

  async close(): Promise<void> {
    try { this.db.close(); } catch { /* already closed */ }
  }

  async ping(): Promise<boolean> {
    try {
      this.db.prepare("SELECT 1").all();
      return true;
    } catch {
      return false;
    }
  }
}

registerDriver("sqlite", () => new NodeSqliteDriver(":memory:"));
registerDriver("sqlite:memory", () => new NodeSqliteDriver(":memory:"));
