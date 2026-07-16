// MountSQLI — schema diff.
// Compares two schema snapshots (before/after) and produces a structured,
// ordered list of changes. Pure function — no DB access. SQL generation
// (per dialect) happens separately in `generate.ts`.

import type { ColumnDef, TableDef } from "@mountsqli/schema";

export type Change =
  | { kind: "create_table"; table: TableDef }
  | { kind: "drop_table"; table: string }
  | { kind: "add_column"; table: string; column: ColumnDef }
  | { kind: "drop_column"; table: string; column: string }
  | { kind: "alter_column"; table: string; column: string; from: ColumnDef; to: ColumnDef }
  | { kind: "add_index"; table: string; columns: string[] }
  | { kind: "drop_index"; table: string; columns: string[] };
  // Note: multi-column PK/unique/FK/check diffs are handled by recreating the table
  // (schema-level changes are tracked as table-level diffs in the snapshot).

export type DestructiveChange = "drop_table" | "drop_column" | "alter_column";

export interface DiffResult {
  changes: Change[];
  /** Subset of changes that are destructive and need review. */
  destructive: Change[];
}

function colMap(t: TableDef): Map<string, ColumnDef> {
  return new Map(t.columns.map((c) => [c.name, c]));
}

export function diffSchemas(before: TableDef[], after: TableDef[]): DiffResult {
  const beforeTables = new Map(before.map((t) => [t.name, t]));
  const afterTables = new Map(after.map((t) => [t.name, t]));
  const changes: Change[] = [];

  // created tables
  for (const [name, t] of afterTables) {
    if (!beforeTables.has(name)) {
      changes.push({ kind: "create_table", table: t });
      continue;
    }
    const bt = beforeTables.get(name)!;
    const bc = colMap(bt);
    const ac = colMap(t);
    // added columns
    for (const [cn, c] of ac) {
      if (!bc.has(cn)) changes.push({ kind: "add_column", table: name, column: c });
    }
    // dropped columns
    for (const [cn] of bc) {
      if (!ac.has(cn)) changes.push({ kind: "drop_column", table: name, column: cn });
    }
    // altered columns (type / nullability / default / unique)
    for (const [cn, acol] of ac) {
      const bcol = bc.get(cn);
      if (bcol && !sameColumn(bcol, acol)) {
        changes.push({ kind: "alter_column", table: name, column: cn, from: bcol, to: acol });
      }
    }
    // unique index changes (simple: index on unique columns not already indexed)
    const beforeUniques = new Set(bt.columns.filter((c) => c.unique && !c.primaryKey).map((c) => c.name));
    for (const c of t.columns) {
      if (c.unique && !c.primaryKey && !beforeUniques.has(c.name)) {
        changes.push({ kind: "add_index", table: name, columns: [c.name] });
      }
    }
  }

  // dropped tables
  for (const [name] of beforeTables) {
    if (!afterTables.has(name)) changes.push({ kind: "drop_table", table: name });
  }

  const destructive = changes.filter((c) =>
    c.kind === "drop_table" || c.kind === "drop_column" || c.kind === "alter_column",
  );
  return { changes, destructive };
}

function sameColumn(a: ColumnDef, b: ColumnDef): boolean {
  const unique = (c: ColumnDef) => c.unique === true;
  const def = (c: ColumnDef) => (c.default === undefined || c.default === null ? "" : String(c.default));
  const refStr = (r?: { table: string; column: string; onDelete?: string; onUpdate?: string }) =>
    r ? `${r.table}.${r.column}${r.onDelete ?? ""}${r.onUpdate ?? ""}` : "";
  const enumStr = (c: ColumnDef) => c.type === "enum" ? (c.enumValues ?? []).join(",") : "";
  return (
    a.type === b.type &&
    a.nullable === b.nullable &&
    unique(a) === unique(b) &&
    def(a) === def(b) &&
    (a.defaultExpr ?? "") === (b.defaultExpr ?? "") &&
    (a.onUpdate ?? "") === (b.onUpdate ?? "") &&
    refStr(a.references) === refStr(b.references) &&
    (a.check ?? "") === (b.check ?? "") &&
    enumStr(a) === enumStr(b)
  );
}
