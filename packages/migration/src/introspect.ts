// MountSQLI — database introspection (reverse engineering).
// Reads a live database's metadata and produces TableDef[]. The SQLite and
// Postgres readers share one interface; more dialects can be added by
// implementing `Introspector`.

import type { Driver } from "@mountsqli/driver";
import type { ColumnDef, ColumnType, TableDef } from "@mountsqli/schema";

export interface Introspector {
  introspect(driver: Driver): Promise<TableDef[]>;
}

function mapSqliteType(decl: string): ColumnType {
  const t = decl.toUpperCase();
  if (t.includes("INT")) return "int";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "real";
  if (t.includes("BLOB")) return "blob";
  return "text";
}

export const sqliteIntrospector: Introspector = {
  async introspect(driver) {
    const tablesRes = await driver.query<any>({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_mount%'", params: [] }, "many");
    const out: TableDef[] = [];
    for (const { name } of tablesRes.rows) {
      const colsRes = await driver.query<any>({ sql: `PRAGMA table_info(${JSON.stringify(name)})`, params: [] }, "many");
      // unique columns come from unique indexes
      const idxRes = await driver.query<any>({ sql: `PRAGMA index_list(${JSON.stringify(name)})`, params: [] }, "many");
      const uniqueCols = new Set<string>();
      for (const idx of idxRes.rows) {
        if (idx.unique === 1 || idx.unique === true) {
          const info = await driver.query<any>({ sql: `PRAGMA index_info(${JSON.stringify(idx.name)})`, params: [] }, "many");
          for (const ci of info.rows) uniqueCols.add(ci.name);
        }
      }
      const columns: ColumnDef[] = colsRes.rows.map((c: any) => ({
        name: c.name,
        type: mapSqliteType(c.type ?? "TEXT"),
        // A primary key column is implicitly NOT NULL in SQLite even when
        // PRAGMA reports notnull = 0. Treat PK as non-nullable so diffs match.
        nullable: c.pk === 1 ? false : c.notnull === 0,
        primaryKey: c.pk === 1,
        unique: uniqueCols.has(c.name) && c.pk !== 1,
        default: c.dflt_value ?? undefined,
      }));
      out.push({ name, columns });
    }
    return out;
  },
};

export const postgresIntrospector: Introspector = {
  async introspect(driver) {
    const tablesRes = await driver.query<any>({
      sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      params: [],
    }, "many");
    const out: TableDef[] = [];
    for (const { table_name } of tablesRes.rows) {
      const colsRes = await driver.query<any>({
        sql: `SELECT column_name, data_type, is_nullable, column_default
              FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
        params: [table_name],
      }, "many");
      const columns: ColumnDef[] = colsRes.rows.map((c: any) => ({
        name: c.column_name,
        type: mapPgType(c.data_type),
        nullable: c.is_nullable === "YES",
        primaryKey: false, // refined below
        unique: false,
        default: c.column_default ?? undefined,
      }));
      out.push({ name: table_name, columns });
    }
    return out;
  },
};

function mapPgType(dt: string): ColumnType {
  const t = dt.toUpperCase();
  if (t.includes("INT") || t === "SERIAL") return "int";
  if (t.includes("BOOL")) return "bool";
  if (t.includes("REAL") || t.includes("DOUBLE") || t.includes("NUMERIC")) return "real";
  if (t.includes("JSON")) return "json";
  if (t.includes("UUID")) return "uuid";
  if (t.includes("TIMESTAMP") || t.includes("DATE")) return "timestamp";
  if (t.includes("BYTEA")) return "blob";
  return "text";
}

export function introspectorFor(dialect: string): Introspector {
  return dialect === "postgres" || dialect === "pg" ? postgresIntrospector : sqliteIntrospector;
}
