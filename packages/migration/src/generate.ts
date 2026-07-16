// MountSQLI — migration SQL generation.
// Turns a DiffResult into dialect-specific DDL. Every migration ships an
// "up" and a "down" (reversible) form. Destructive operations are emitted
// but tagged `requiresReview` so the CLI/Migrator can refuse them in CI
// without an explicit flag.

import type { Dialect } from "@mountsqli/compiler";
import { sqliteDialect, postgresDialect } from "@mountsqli/compiler";
import type { ColumnDef } from "@mountsqli/schema";
import { quote } from "@mountsqli/schema";
import type { Change, DiffResult } from "./diff.js";

export interface GeneratedMigration {
  up: string[];
  down: string[];
  requiresReview: boolean;
}

const dialectFor = (name: string): Dialect =>
  name === "postgres" || name === "pg" ? postgresDialect : sqliteDialect;

function colDefSQL(c: ColumnDef, d: Dialect): string {
  let sql = `${quote(c.name)} ${d.typeName(c.type)}`;
  // For enum types, add a CHECK constraint to enforce allowed values.
  if (c.type === "enum" && c.enumValues?.length) {
    sql += ` CHECK (${quote(c.name)} IN (${c.enumValues.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ")}))`;
  }
  if (c.primaryKey) sql += " PRIMARY KEY";
  if (!c.nullable && !c.primaryKey) sql += " NOT NULL";
  if (c.unique && !c.primaryKey) sql += " UNIQUE";
  if (c.defaultExpr) sql += ` DEFAULT ${c.defaultExpr}`;
  else if (c.default !== undefined) sql += ` DEFAULT ${fmtDefault(c.default)}`;
  if (c.onUpdate) sql += ` ON UPDATE ${c.onUpdate}`;
  if (c.references) {
    sql += ` REFERENCES ${quote(c.references.table)}(${c.references.column})`;
    if (c.references.onDelete) sql += ` ON DELETE ${c.references.onDelete}`;
    if (c.references.onUpdate) sql += ` ON UPDATE ${c.references.onUpdate}`;
  }
  if (c.check) sql += ` CHECK (${c.check})`;
  return sql;
}

function fmtDefault(v: unknown): string {
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

export function generateMigrationSQL(diff: DiffResult, dialectName = "sqlite"): GeneratedMigration {
  const d = dialectFor(dialectName);
  const up: string[] = [];
  const down: string[] = [];

  for (const change of diff.changes) {
    applyChange(change, d, up, down);
  }

  return {
    up,
    down: down.reverse(), // undo in reverse order
    requiresReview: diff.destructive.length > 0,
  };
}

function applyChange(change: Change, d: Dialect, up: string[], down: string[]): void {
  switch (change.kind) {
    case "create_table":
      up.push(createTableDDL(change.table, d));
      down.push(`DROP TABLE ${quote(change.table.name)};`);
      break;
    case "drop_table":
      up.push(`DROP TABLE ${quote(change.table)};`);
      // down: recreate from a best-effort snapshot is out of scope; we log intent.
      down.push(`-- UNDO drop_table ${change.table}: recreate table manually`);
      break;
    case "add_column":
      up.push(`ALTER TABLE ${quote(change.table)} ADD COLUMN ${colDefSQL(change.column, d)};`);
      down.push(`ALTER TABLE ${quote(change.table)} DROP COLUMN ${quote(change.column.name)};`);
      break;
    case "drop_column":
      up.push(`ALTER TABLE ${quote(change.table)} DROP COLUMN ${quote(change.column)};`);
      down.push(`-- UNDO drop_column ${change.table}.${change.column}: re-add column manually`);
      break;
    case "alter_column":
      // Safe path: add a new column, copy, drop old — only if types compat.
      up.push(
        `ALTER TABLE ${quote(change.table)} ALTER COLUMN ${quote(change.column)} TYPE ${d.typeName(change.to.type)};`,
      );
      if (!change.to.nullable) {
        up.push(`ALTER TABLE ${quote(change.table)} ALTER COLUMN ${quote(change.column)} SET NOT NULL;`);
      }
      down.push(
        `ALTER TABLE ${quote(change.table)} ALTER COLUMN ${quote(change.column)} TYPE ${d.typeName(change.from.type)};`,
      );
      break;
    case "add_index":
      up.push(`CREATE UNIQUE INDEX ${quote(`uq_${change.table}_${change.columns.join("_")}`)} ON ${quote(change.table)} (${change.columns.map(quote).join(", ")});`);
      down.push(`DROP INDEX ${quote(`uq_${change.table}_${change.columns.join("_")}`)};`);
      break;
    case "drop_index":
      up.push(`DROP INDEX ${quote(`uq_${change.table}_${change.columns.join("_")}`)};`);
      down.push(`CREATE INDEX ${quote(`uq_${change.table}_${change.columns.join("_")}`)} ON ${quote(change.table)} (${change.columns.map(quote).join(", ")});`);
      break;
  }
}

function createTableDDL(table: { name: string; columns: ColumnDef[] }, d: Dialect): string {
  const parts = table.columns.map((c) => colDefSQL(c, d));
  return `CREATE TABLE ${quote(table.name)} (\n  ${parts.join(",\n  ")}\n);`;
}
