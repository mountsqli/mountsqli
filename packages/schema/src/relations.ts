// MountSQLI — Relationship detection and data joining.
//
// Provides a declarative way to define relationships between tables
// (belongsTo, hasMany, hasOne) and resolve them into nested data using
// a batch-loading strategy (the N+1 problem is eliminated by collecting
// all foreign keys first and fetching related rows in a single query per
// table).
//
// Conventions (auto-detected when not explicitly specified):
//   - belongsTo("author", "users")  → FK = authorId
//   - hasMany("posts")             → FK on the other table = thisTable_singular + "Id"
//   - The FK is derived from the relationship name + "Id"

import type { TableDef, Table } from "./index.js";

// ---------------------------------------------------------------------------
// Minimal query interface (accepts any Db that has .raw())
// ---------------------------------------------------------------------------

export interface RawQueryFn {
  raw(sql: string, params?: unknown[]): Promise<any[]>;
}

// ---------------------------------------------------------------------------
// Relationship types
// ---------------------------------------------------------------------------

export type RelationshipKind = "belongsTo" | "hasMany" | "hasOne";

export interface RelationshipDef {
  /** The local field name on the parent (e.g. "author", "comments"). */
  name: string;
  /** The related table name. */
  targetTable: string;
  kind: RelationshipKind;
  /** The foreign key column on the source table (belongsTo) or target table (hasMany/hasOne). */
  foreignKey: string;
  /** The local key that the FK references (default: "id"). */
  localKey: string;
}

export type RelatableTable<T extends string = string> = {
  __name: string;
  __cols: Record<string, any>;
  relations?: RelationshipDef[];
};

// ---------------------------------------------------------------------------
// Relationship builder
// ---------------------------------------------------------------------------

export function belongsTo(name: string, targetTable?: string): RelationshipBuilder {
  return new RelationshipBuilder(name, "belongsTo", targetTable);
}

export function hasMany(name: string, targetTable?: string): RelationshipBuilder {
  return new RelationshipBuilder(name, "hasMany", targetTable);
}

export function hasOne(name: string, targetTable?: string): RelationshipBuilder {
  return new RelationshipBuilder(name, "hasOne", targetTable);
}

export class RelationshipBuilder {
  private _fk?: string;
  private _localKey: string = "id";

  constructor(
    public readonly name: string,
    public readonly kind: RelationshipKind,
    public readonly targetTable?: string,
  ) {}

  /** Explicitly set the foreign key column. */
  foreignKey(col: string): this {
    this._fk = col;
    return this;
  }

  /** Explicitly set the local key column (default: "id"). */
  localKey(col: string): this {
    this._localKey = col;
    return this;
  }

  toDef(sourceTableName: string): RelationshipDef {
    // Infer target table name if not given
    const target = this.targetTable ?? this.inferTarget(sourceTableName, this.kind, this.name);
    // Infer FK column if not given
    const fk = this._fk ?? this.inferForeignKey(sourceTableName, this.kind, this.name, target);
    return {
      name: this.name,
      targetTable: target,
      kind: this.kind,
      foreignKey: fk,
      localKey: this._localKey,
    };
  }

  private inferTarget(source: string, kind: RelationshipKind, name: string): string {
    if (kind === "belongsTo") {
      // "author" → "authors" (pluralize)
      return name.endsWith("s") ? name : `${name}s`;
    }
    // hasMany/hasOne: name is already the target table name
    return name;
  }

  private inferForeignKey(source: string, kind: RelationshipKind, name: string, target: string): string {
    if (kind === "belongsTo") {
      // "author" → "authorId"
      return `${name}Id`;
    }
    // hasMany/hasOne: FK is on the TARGET table pointing back to source
    // "users" → "userId"; strip trailing 's'
    const singular = source.endsWith("s") ? source.slice(0, -1) : source;
    return `${singular}Id`;
  }
}

// ---------------------------------------------------------------------------
// Resolver: batch-loads relationships into any result set
// ---------------------------------------------------------------------------

export type Resolved<T> = T & Record<string, any>;

export interface ResolveOptions {
  /** Max depth for recursive eager-loading (default 2). */
  depth?: number;
}

/**
 * Given a query interface + a table definition (with `.relations`), eagerly
 * load all relationships into the result rows using batch queries.
 * The N+1 problem is eliminated by collecting all foreign keys first and
 * fetching related rows in a single query per table.
 *
 * ```ts
 * const posts = await db.query(posts).select();
 * const withAuthors = await resolveRelations(db, [users, posts], postsDef, posts);
 * // withAuthors[0].author → { id: 1, name: "Alice", ... }
 * ```
 */
export async function resolveRelations<T extends Record<string, any>>(
  db: RawQueryFn,
  tables: RelatableTable[],
  table: RelatableTable,
  rows: T[],
  options: ResolveOptions = {},
): Promise<Resolved<T>[]> {
  if (!table.relations || table.relations.length === 0) return rows as Resolved<T>[];
  if (rows.length === 0) return [];

  const depth = options.depth ?? 2;
  if (depth <= 0) return rows as Resolved<T>[];

  let resolved = [...rows] as Resolved<T>[];

  for (const rel of table.relations) {
    const targetTable = tables.find((t: RelatableTable) => t.__name === rel.targetTable);
    if (!targetTable) continue;

    if (rel.kind === "belongsTo") {
      const fkValues = [...new Set(resolved.map((r) => r[rel.foreignKey]).filter(Boolean))];
      if (fkValues.length === 0) continue;
      const raw = await db.raw(
        `SELECT * FROM "${rel.targetTable}" WHERE "${rel.localKey}" IN (${fkValues.map(() => "?").join(",")})`,
        fkValues,
      );
      const relatedMap = new Map(raw.map((r: any) => [r[rel.localKey], r]));
      resolved = resolved.map((r) => ({ ...r, [rel.name]: relatedMap.get(r[rel.foreignKey]) ?? null }));
      for (const row of [...relatedMap.values()] as any[]) {
        Object.assign(row, await resolveRelations(db, tables, targetTable as RelatableTable, [row], { depth: depth - 1 }).then((r) => r[0]));
      }
    }

    if (rel.kind === "hasMany") {
      const localValues = [...new Set(resolved.map((r) => r[rel.localKey]).filter(Boolean))];
      if (localValues.length === 0) continue;
      const raw = await db.raw(
        `SELECT * FROM "${rel.targetTable}" WHERE "${rel.foreignKey}" IN (${localValues.map(() => "?").join(",")})`,
        localValues,
      );
      const grouped = new Map<any, any[]>();
      for (const row of raw as any[]) {
        const val = row[rel.foreignKey];
        if (!grouped.has(val)) grouped.set(val, []);
        grouped.get(val)!.push(row);
      }
      resolved = resolved.map((r) => ({ ...r, [rel.name]: grouped.get(r[rel.localKey]) ?? [] }));
      const allRelated = [...grouped.values()].flat();
      for (const row of allRelated as any[]) {
        Object.assign(row, await resolveRelations(db, tables, targetTable as RelatableTable, [row], { depth: depth - 1 }).then((r) => r[0]));
      }
    }

    if (rel.kind === "hasOne") {
      const localValues = [...new Set(resolved.map((r) => r[rel.localKey]).filter(Boolean))];
      if (localValues.length === 0) continue;

      const raw = await db.raw(
        `SELECT * FROM "${rel.targetTable}" WHERE "${rel.foreignKey}" IN (${localValues.map(() => "?").join(",")})`,
        localValues,
      );
      const relatedMap = new Map<any, any>();
      for (const row of raw as any[]) {
        // hasOne: take first match per FK
        if (!relatedMap.has(row[rel.foreignKey])) {
          relatedMap.set(row[rel.foreignKey], row);
        }
      }

      resolved = resolved.map((r) => ({
        ...r,
        [rel.name]: relatedMap.get(r[rel.localKey]) ?? null,
      }));
    }
  }

  return resolved;
}
