// MountSQLI — migration umbrella.

export * from "./diff.js";
export * from "./generate.js";
export * from "./introspect.js";
export * from "./migrator.js";
export { diffSchemas } from "./diff.js";
export type { DiffResult, Change } from "./diff.js";
export type { GeneratedMigration } from "./generate.js";
export type { Introspector } from "./introspect.js";
export { Migrator } from "./migrator.js";
export type { MigrationRecord, MigrationStep, ApplyOptions } from "./migrator.js";

import type { Table, TableDef } from "@mountsqli/schema";
import { diffSchemas, type DiffResult } from "./diff.js";

/** Convenience: build a DiffResult from before/after table definitions. */
export function diffTables(before: TableDef[], after: TableDef[]): DiffResult {
  return diffSchemas(before, after);
}

/** Convenience: extract TableDef[] from defineTable() outputs. */
export function tablesOf(...tables: Table<any>[]): TableDef[] {
  return tables.map((t) => t.def);
}
