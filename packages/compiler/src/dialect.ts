// MountSQLI — SQL dialect abstraction.
// A dialect translates the engine-agnostic QueryPlan into a driver-specific
// SQL string + parameter style. This is the ONLY place that knows about
// `$1` vs `?`, quoting, AUTO_INCREMENT vs AUTOINCREMENT, RETURNING vs no.

import type { ColumnType } from "@mountsqli/schema";

export type ParamStyle = "positional" | "numbered";

export interface Dialect {
  readonly name: string;
  readonly paramStyle: ParamStyle;
  /** Quote an identifier (table/column). */
  quoteIdent(id: string): string;
  /** Quote a string literal (used only for DDL defaults, never user values). */
  quoteLiteral(value: string): string;
  /** Convert a 1-based parameter index into the dialect's placeholder token. */
  param(i: number): string;
  /** True if the dialect supports `RETURNING` (Postgres/SQLite). */
  supportsReturning: boolean;
  /** Type name mapping for DDL. */
  typeName(type: ColumnType): string;
}

const sqliteTypes: Record<ColumnType, string> = { int: "INTEGER", text: "TEXT", real: "REAL", bool: "INTEGER", blob: "BLOB", json: "TEXT", uuid: "TEXT", timestamp: "TEXT", enum: "TEXT" };
const pgTypes: Record<ColumnType, string> = { int: "INTEGER", text: "TEXT", real: "DOUBLE PRECISION", bool: "BOOLEAN", blob: "BYTEA", json: "JSONB", uuid: "UUID", timestamp: "TIMESTAMPTZ", enum: "TEXT" };
const mysqlTypes: Record<ColumnType, string> = { int: "INTEGER", text: "VARCHAR(255)", real: "DOUBLE", bool: "TINYINT(1)", blob: "BLOB", json: "JSON", uuid: "CHAR(36)", timestamp: "TIMESTAMP", enum: "VARCHAR(255)" };

export const sqliteDialect: Dialect = {
  name: "sqlite",
  paramStyle: "positional",
  quoteIdent: (id) => `"${id.replace(/"/g, '""')}"`,
  quoteLiteral: (v) => `'${v.replace(/'/g, "''")}'`,
  param: () => "?",
  supportsReturning: true,
  typeName: (t) => sqliteTypes[t],
};

export const postgresDialect: Dialect = {
  name: "postgres",
  paramStyle: "numbered",
  quoteIdent: (id) => `"${id.replace(/"/g, '""')}"`,
  quoteLiteral: (v) => `'${v.replace(/'/g, "''")}'`,
  param: (i) => `$${i}`,
  supportsReturning: true,
  typeName: (t) => pgTypes[t],
};

export const mysqlDialect: Dialect = {
  name: "mysql",
  paramStyle: "positional",
  quoteIdent: (id) => `\`${id.replace(/`/g, "``")}\``,
  quoteLiteral: (v) => `'${v.replace(/'/g, "''")}'`,
  param: () => "?",
  supportsReturning: false,
  typeName: (t) => mysqlTypes[t],
};

const byName = new Map<string, Dialect>();
for (const d of [sqliteDialect, postgresDialect, mysqlDialect]) byName.set(d.name, d);

export function getDialect(name: string): Dialect {
  // Fall back to sqlite dialect for unknown driver names (e.g. "mock" in tests).
  const d = byName.get(name);
  if (!d && name !== "mock") {
    console.warn(`MountSQLI: unknown driver "${name}", falling back to sqlite dialect.`);
  }
  return d ?? sqliteDialect;
}
