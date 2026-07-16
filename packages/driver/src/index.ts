// MountSQLI — Driver contract. Every database talks to MountSQLI through
// this single interface: prepare/execute, transaction, lifecycle.

import type { Compiled, QueryPlan } from "@mountsqli/compiler";
import type { TableDef } from "@mountsqli/schema";
import { MountError } from "./security.js";

export type { Compiled, QueryPlan, TableDef };

export type ExecuteMode = "run" | "one" | "many";

export interface QueryResult<T = any> {
  rows: T[];
  changes: number;
  lastId: number;
  /** For INSERT with RETURNING emulation: the inserted row fetched back. */
  insertedRow?: T;
}

export interface Transaction {
  query<T = any>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /** Create a named savepoint within the transaction. */
  savepoint?(name: string): Promise<void>;
  /** Roll back to a named savepoint without ending the transaction. */
  rollbackTo?(name: string): Promise<void>;
  /** Release a named savepoint. */
  release?(name: string): Promise<void>;
}

export interface Driver {
  readonly name: string;
  readonly ready: Promise<void>;
  init(tables: TableDef[]): Promise<void>;
  query<T = any>(compiled: Compiled, mode: ExecuteMode): Promise<QueryResult<T>>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** Flat column type map (colName -> "bool"|"int"|...) from init(). Used by raw/sql paths. */
  columnTypes?: Record<string, string>;
  /** Health check — returns true if the database connection is alive. */
  ping?(): Promise<boolean>;
  /** RLS enforcement state, attached by `@mountsqli/core` when `enforceRls`
   * is configured (issue 003). The query builder consults it before running. */
  rls?: { enforce: boolean; registry: { has(name: string): boolean } };
}

// Registry so `mount({ driver: "sqlite" })` resolves by name.
const registry = new Map<string, () => Driver>();

export function registerDriver(name: string, factory: () => Driver): void {
  registry.set(name, factory);
}

export function createDriver(name: string): Driver {
  const factory = registry.get(name);
  if (!factory) throw new MountError("CONFIG", `MountSQLI: unknown driver "${name}". Make sure the driver package is imported before mountsqli().`);
  return factory();
}

export function listDrivers(): string[] {
  return [...registry.keys()];
}

export { MockDriver } from "./mock.js";
export type { MockRecording } from "./mock.js";

// ---- security & validation helpers ----
export { tracer, traceSpan } from "./trace.js";

export {
  MountError,
  type MountErrorCode,
  RateLimiter,
  type RateLimiterConfig,
  parseJsonBody,
  validateTableName,
  validateColumnName,
  validateFileKey,
  validateChannelName,
  clampInt,
  classifySql,
  safeErrorResponse,
  corsHeaders,
} from "./security.js";
