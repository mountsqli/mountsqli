// MountSQLI — shared schema types & column builders.
// Column builders carry *phantom* type params so `defineTable`
// can infer exact row types at compile time with zero runtime cost.

export type ColumnType =
  | "int"
  | "text"
  | "real"
  | "bool"
  | "blob"
  | "json"
  | "uuid"
  | "timestamp"
  | "enum";

export interface ForeignKeyDef {
  table: string;
  column: string;
  onDelete?: string;
  onUpdate?: string;
}

export interface ColumnDef {
  name: string;
  type: ColumnType;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  default?: unknown;
  /** SQL-level default expression (e.g. "CURRENT_TIMESTAMP"). Used instead of `default` when set. */
  defaultExpr?: string;
  /** ON UPDATE expression (e.g. "CURRENT_TIMESTAMP"). Emitted in DDL for MySQL/Postgres. */
  onUpdate?: string;
  references?: ForeignKeyDef;
  check?: string;
  /** Enum values — set when type is "enum". */
  enumValues?: string[];
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  /** Multi-column primary key (composite). */
  primaryKey?: string[];
  /** Multi-column unique constraints. */
  unique?: string[][];
  /** Table-level foreign keys (composite). */
  foreignKeys?: { columns: string[]; references: ForeignKeyDef }[];
  /** Table-level CHECK constraints. */
  checks?: string[];
}

// ---- phantom-typed column builder -------------------------------------

export class ColumnBuilder<
  Type extends ColumnType = ColumnType,
  Null extends boolean = false,
> {
  // phantom type slots (never assigned at runtime)
  declare _type: Type;
  declare _null: Null;

  constructor(public def: Omit<ColumnDef, "name">) {}

  nullable(): ColumnBuilder<Type, true> {
    return new ColumnBuilder<Type, true>({ ...this.def, nullable: true }) as never;
  }
  notNull(): ColumnBuilder<Type, false> {
    return new ColumnBuilder<Type, false>({ ...this.def, nullable: false }) as never;
  }
  pk(): this {
    return new ColumnBuilder<Type, Null>({ ...this.def, primaryKey: true }) as this;
  }
  unique(): this {
    return new ColumnBuilder<Type, Null>({ ...this.def, unique: true }) as this;
  }
  default(value: unknown): this {
    return new ColumnBuilder<Type, Null>({ ...this.def, default: value }) as this;
  }
  /** Add a FOREIGN KEY reference. */
  references(table: string, column: string, opts?: { onDelete?: string; onUpdate?: string }): this {
    return new ColumnBuilder<Type, Null>({
      ...this.def, references: { table, column, ...opts },
    }) as this;
  }
  /** Add a CHECK constraint. */
  check(expr: string): this {
    return new ColumnBuilder<Type, Null>({ ...this.def, check: expr }) as this;
  }
  /** Set the default to `CURRENT_TIMESTAMP` (SQL-level, not JS). */
  defaultNow(): this {
    return new ColumnBuilder<Type, Null>({ ...this.def, defaultExpr: "CURRENT_TIMESTAMP" }) as this;
  }
  /** Set an ON UPDATE expression (e.g. `CURRENT_TIMESTAMP`). */
  onUpdate(expr: string = "CURRENT_TIMESTAMP"): this {
    return new ColumnBuilder<Type, Null>({ ...this.def, onUpdate: expr }) as this;
  }
}

// ---- column factory functions -----------------------------------------

export const int = () => new ColumnBuilder<"int">({ type: "int", nullable: false, primaryKey: false, unique: false });
export const text = () => new ColumnBuilder<"text">({ type: "text", nullable: false, primaryKey: false, unique: false });
export const real = () => new ColumnBuilder<"real">({ type: "real", nullable: false, primaryKey: false, unique: false });
export const bool = () => new ColumnBuilder<"bool">({ type: "bool", nullable: false, primaryKey: false, unique: false });
export const blob = () => new ColumnBuilder<"blob">({ type: "blob", nullable: false, primaryKey: false, unique: false });
export const json = () => new ColumnBuilder<"json">({ type: "json", nullable: false, primaryKey: false, unique: false });
export const uuid = () => new ColumnBuilder<"uuid">({ type: "uuid", nullable: false, primaryKey: false, unique: false });
export const timestamp = () => new ColumnBuilder<"timestamp">({ type: "timestamp", nullable: false, primaryKey: false, unique: false });

/**
 * Create an ENUM column.
 * ```ts
 * const mood = enum("happy", "sad", "meh");
 * defineTable("users", { mood: mood() });
 * ```
 */
export const enum_ = <V extends string>(...values: V[]) =>
  new ColumnBuilder<"enum", false>({ type: "enum", nullable: false, primaryKey: false, unique: false, enumValues: values });

/** Alias for TypeScript users who prefer `enum` import name. */
export { enum_ as enum };

// ---- type inference ---------------------------------------------------

export type TypeMap = {
  int: number;
  text: string;
  real: number;
  bool: boolean;
  blob: Uint8Array;
  json: unknown;
  uuid: string;
  timestamp: Date;
  enum: string;
};

export type InferCol<B> = B extends ColumnBuilder<infer T, infer N>
  ? N extends true
    ? TypeMap[T] | null
    : TypeMap[T]
  : never;

export type InferTable<C extends Record<string, ColumnBuilder<any, any>>> = {
  [K in keyof C]: InferCol<C[K]>;
};

export type Table<C extends Record<string, ColumnBuilder<any, any>> = Record<string, ColumnBuilder<any, any>>> = {
  __name: string;
  __cols: C;
  __row: InferTable<C>;
  def: TableDef;
  /** Optional relationship definitions for eager-loading joins. */
  relations?: import("./relations.js").RelationshipDef[];
};

export interface TableOptions {
  /** Multi-column primary key. */
  primaryKey?: string[];
  /** Multi-column unique constraints (each array is one group). */
  unique?: string[][];
  /** Table-level foreign keys (composite). */
  foreignKeys?: { columns: string[]; references: ForeignKeyDef }[];
  /** Table-level CHECK constraints. */
  checks?: string[];
  /** Relationship definitions for eager-loading (belongsTo, hasMany, hasOne). */
  relations?: (import("./relations.js").RelationshipBuilder | import("./relations.js").RelationshipDef)[];
}

export function defineTable<C extends Record<string, ColumnBuilder<any, any>>>(
  name: string,
  columns: C,
  options?: TableOptions,
): Table<C> {
  const def: TableDef = {
    name,
    columns: Object.entries(columns).map(([colName, builder]) => ({
      name: colName,
      ...builder.def,
    })),
    ...(options?.primaryKey ? { primaryKey: options.primaryKey } : {}),
    ...(options?.unique ? { unique: options.unique } : {}),
    ...(options?.foreignKeys ? { foreignKeys: options.foreignKeys } : {}),
    ...(options?.checks ? { checks: options.checks } : {}),
  };
  const relations: import("./relations.js").RelationshipDef[] | undefined = options?.relations?.map((r) =>
    r && typeof r === "object" && "toDef" in r ? r.toDef(name) : r as import("./relations.js").RelationshipDef,
  );
  return { __name: name, __cols: columns, __row: undefined as never, def, ...(relations ? { relations } : {}) };
}

// ---- DDL generation (shared by drivers / migrations) ------------------

function constraintPart(col: string, q: (id: string) => string): string {
  return `FOREIGN KEY (${col}) REFERENCES${/* handled per-ref */ ""}`;
}

export function createTableSQL(
  table: TableDef,
  typeName: (t: ColumnType) => string = defaultType,
  autoIncrement = "",
  /** Identifier quoting function — defaults to double-quote (SQLite/Postgres). MySQL passes backtick quoting. */
  quoteFn: (id: string) => string = quote,
): string {
  const q = quoteFn;
  const parts = table.columns.map((c) => {
    const sqlType = typeName(c.type);
    let col = `${q(c.name)} ${sqlType}`;
    if (c.primaryKey) col += " PRIMARY KEY";
    // MySQL needs AUTO_INCREMENT declared on the integer PK (dialect-specific).
    if (autoIncrement && c.primaryKey && c.type === "int") col += ` ${autoIncrement}`;
    if (!c.nullable && !c.primaryKey) col += " NOT NULL";
    if (c.unique && !c.primaryKey) col += " UNIQUE";
    if (c.defaultExpr) col += ` DEFAULT ${c.defaultExpr}`;
    else if (c.default !== undefined) col += ` DEFAULT ${formatDefault(c.default)}`;
    // ON UPDATE is MySQL-specific and handled in dialect-specific DDL (migration/generate.ts).
    if (c.references) {
      col += ` REFERENCES ${q(c.references.table)}(${q(c.references.column)})`;
      if (c.references.onDelete) col += ` ON DELETE ${c.references.onDelete}`;
      if (c.references.onUpdate) col += ` ON UPDATE ${c.references.onUpdate}`;
    }
    if (c.check) col += ` CHECK (${c.check})`;
    return col;
  });

  // Multi-column constraints
  if (table.primaryKey) {
    parts.push(`PRIMARY KEY (${table.primaryKey.map(q).join(", ")})`);
  }
  for (const uq of table.unique ?? []) {
    parts.push(`UNIQUE (${uq.map(q).join(", ")})`);
  }
  for (const fk of table.foreignKeys ?? []) {
    let fkSql = `FOREIGN KEY (${fk.columns.map(q).join(", ")}) REFERENCES ${q(fk.references.table)}(${q(fk.references.column)})`;
    if (fk.references.onDelete) fkSql += ` ON DELETE ${fk.references.onDelete}`;
    if (fk.references.onUpdate) fkSql += ` ON UPDATE ${fk.references.onUpdate}`;
    parts.push(fkSql);
  }
  for (const check of table.checks ?? []) {
    parts.push(`CHECK (${check})`);
  }

  return `CREATE TABLE IF NOT EXISTS ${q(table.name)} (\n  ${parts.join(",\n  ")}\n);`;
}

export function quote(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function defaultType(t: ColumnType): string {
  const map = { int: "INTEGER", text: "TEXT", real: "REAL", bool: "INTEGER", blob: "BLOB", json: "TEXT", uuid: "TEXT", timestamp: "TEXT", enum: "TEXT" };
  const sql = map[t];
  if (sql === undefined) throw new Error(`MountSQLI: unknown column type "${t}". Use one of: ${Object.keys(map).join(", ")}.`);
  return sql;
}

function formatDefault(value: unknown): string {
  if (typeof value === "string") {
    // SQL keywords (CURRENT_TIMESTAMP, TRUE, FALSE) are all-uppercase.
    // SQL function calls (gen_random_uuid(), now()) have parentheses.
    // Everything else (user-provided text defaults like "user", "draft") gets quoted.
    if (/^[A-Z_][A-Z0-9_]*$/.test(value)) return value;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*\(.*\)$/.test(value)) return value;
    return `'${value.replace(/'/g, "''")}'`;
  }
  // MountSQLI stores booleans as 0/1 (see storage invariant), so the SQL
  // default must be numeric. `1`/`0` is valid for both SQLite (INTEGER)
  // and Postgres (BOOLEAN DEFAULT 1).
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

// ---- relationships (eager-loading join resolver) ----
export {
  belongsTo,
  hasMany,
  hasOne,
  resolveRelations,
  RelationshipBuilder,
} from "./relations.js";
export type {
  RelationshipDef,
  RelationshipKind,
  RelatableTable,
  Resolved,
} from "./relations.js";
