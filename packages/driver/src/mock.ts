// MountSQLI — in-memory MockDriver.
// Records every compiled plan it receives and returns scripted rows.
// Used for fast, deterministic unit tests of the query + migration layers
// without spinning up a real database.

import type { Compiled, ExecuteMode, QueryResult, Transaction, Driver } from "./index.js";
import type { TableDef } from "@mountsqli/schema";

export interface MockRecording {
  sql: string;
  params: unknown[];
  mode: ExecuteMode;
}

export class MockDriver implements Driver {
  readonly name = "mock";
  readonly ready = Promise.resolve();
  readonly log: MockRecording[] = [];

  /** Scripted responses keyed by substring match against the SQL. */
  responses = new Map<RegExp, unknown[]>();

  constructor(private tables: TableDef[] = []) {}

  async init(tables: TableDef[]): Promise<void> {
    this.tables.push(...tables);
  }

  script(match: RegExp, rows: unknown[]): this {
    this.responses.set(match, rows);
    return this;
  }

  async query<T = any>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>> {
    this.log.push({ sql: compiled.sql, params: compiled.params, mode });
    const rows = this.match(compiled.sql) as T[];
    if (mode === "run") return { rows: [], changes: 1, lastId: 1 };
    const final = mode === "one" ? rows.slice(0, 1) : rows;
    return { rows: final, changes: 0, lastId: 0 };
  }

  private match(sql: string): unknown[] {
    for (const [re, rows] of this.responses) if (re.test(sql)) return rows;
    return [];
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx: Transaction = {
      query: (c, m) => this.query(c, m),
      commit: async () => {},
      rollback: async () => {},
    };
    return fn(tx);
  }

  async close(): Promise<void> {}
}
