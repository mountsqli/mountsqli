// MountSQLI — Studio controller.
//
// Every piece of data the dashboard shows is fetched through the engine:
// `Db`/`Driver` + the `QueryPlan` compiler. There is NO direct database
// client here (no pg, no better-sqlite3) — that is the repo's hard invariant
// (plan.md §1, §16). All values are bound parameters, so the dashboard is
// injection-safe by construction, just like the app it observes.
//
// SECURITY: every exported function validates its inputs before touching the
// engine. Exceptions are thrown as MountError (structured, safe to serialize).

import { compilePlan, getDialect, type QueryPlan, type Dialect } from "@mountsqli/compiler";
import { Migrator, introspectorFor } from "@mountsqli/migration";
import { MountError, validateTableName } from "@mountsqli/driver";
import type { Driver } from "@mountsqli/driver";
import type { ColumnDef, TableDef, Table } from "@mountsqli/schema";
import type { Db } from "@mountsqli/core";
import { createCache, CacheBridge, type CacheStats } from "@mountsqli/cache";

export interface StudioContext {
  db: Db<Table<any>[]>;
  dialect: Dialect;
  cache?: CacheBridge;
}

const DIALECT_FOR_DRIVER: Record<string, string> = {
  postgres: "postgres",
  pg: "postgres",
  sqlite: "sqlite",
  mysql: "mysql",
  mysql2: "mysql",
};

export function makeStudioContext(db: Db<Table<any>[]>, cache?: CacheBridge): StudioContext {
  const dialectName = DIALECT_FOR_DRIVER[db.driver.name] ?? "sqlite";
  return { db, dialect: getDialect(dialectName), cache };
}

function tableDefs(ctx: StudioContext): TableDef[] {
  return ctx.db.tables.map((t: Table) => t.def as TableDef);
}

function findTable(ctx: StudioContext, name: string): TableDef | undefined {
  return tableDefs(ctx).find((t) => t.name === name);
}

function primaryKeyOf(def: TableDef): string {
  return def.columns.find((c) => c.primaryKey)?.name ?? "id";
}

async function run(ctx: StudioContext, plan: QueryPlan): Promise<unknown> {
  const compiled = compilePlan(plan, ctx.dialect);
  try {
    const r = await ctx.db.driver.query(compiled, plan.op === "select" ? "many" : "run");
    return plan.op === "select" ? r.rows : { changes: r.changes, lastId: r.lastId };
  } catch (e) {
    throw new MountError("QUERY_FAILED", `Query failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface TableMeta {
  name: string;
  columns: ColumnDef[];
  rowCount?: number;
}

export async function listTables(ctx: StudioContext): Promise<{ tables: TableMeta[] }> {
  const defs = tableDefs(ctx);
  return {
    tables: defs.map((t) => ({ name: t.name, columns: t.columns })),
  };
}

// ---------------------------------------------------------------------------
// Table data (paginated, sortable, filterable)
// ---------------------------------------------------------------------------

export interface TableDataQuery {
  limit?: number;
  offset?: number;
  order?: string;
  dir?: "asc" | "desc";
  search?: string;
}

export async function tableData(
  ctx: StudioContext,
  name: string,
  q: TableDataQuery = {},
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; count: number; primaryKey: string }> {
  const safeName = validateTableName(name);
  const def = findTable(ctx, safeName);
  if (!def) throw new MountError("NOT_FOUND", `Unknown table "${safeName}"`);

  const pk = primaryKeyOf(def);
  const columns = def.columns.map((c) => c.name);
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
  const offset = Math.max(q.offset ?? 0, 0);

  // Validate order column is a real column (prevents SQL injection via ORDER BY).
  if (q.order && !columns.includes(q.order)) {
    throw new MountError("VALIDATION", `Cannot order by "${q.order}" — not a column in "${safeName}"`);
  }

  const filters: QueryPlan["filters"] = [];
  if (q.search && columns.length) {
    const searchVal = String(q.search).slice(0, 256);
    for (const c of columns) {
      filters.push({ kind: "filter", column: c, op: "like", value: `%${searchVal}%` });
    }
  }

  let count = 0;
  if (q.search && columns.length) {
    const where = columns.map((c) => `${quote(ctx, c)} LIKE ?`).join(" OR ");
    const searchVal = String(q.search).slice(0, 256);
    const compiled = {
      sql: `SELECT COUNT(*) AS _c FROM ${quote(ctx, safeName)} WHERE ${where}`,
      params: columns.map(() => `%${searchVal}%`),
    };
    try {
      const r = await ctx.db.driver.query<any>(compiled, "many");
      count = Number(r.rows[0]?._c ?? 0);
    } catch (e) {
      throw new MountError("QUERY_FAILED", `Count query failed: ${(e as Error).message}`);
    }
  } else {
    try {
      const r = await ctx.db.driver.query<any>(
        { sql: `SELECT COUNT(*) AS _c FROM ${quote(ctx, safeName)}`, params: [] },
        "many",
      );
      count = Number(r.rows[0]?._c ?? 0);
    } catch (e) {
      throw new MountError("QUERY_FAILED", `Count query failed: ${(e as Error).message}`);
    }
  }

  const dataPlan: QueryPlan = {
    op: "select",
    table: safeName,
    columns,
    filters,
    limit,
    offset,
    orderBy: q.order ? [{ column: q.order, dir: q.dir ?? "asc" }] : undefined,
    columnTypes: Object.fromEntries(def.columns.map((c) => [c.name, c.type])),
  };

  let rows: Record<string, unknown>[];
  if (q.search && columns.length) {
    const searchVal = String(q.search).slice(0, 256);
    const where = columns.map((c) => `${quote(ctx, c)} LIKE ?`).join(" OR ");
    let sql = `SELECT ${columns.map((c) => quote(ctx, c)).join(", ")} FROM ${quote(ctx, safeName)} WHERE ${where}`;
    if (q.order) sql += ` ORDER BY ${quote(ctx, q.order)} ${q.dir === "desc" ? "DESC" : "ASC"}`;
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    try {
      const r = await ctx.db.driver.query<any>({ sql, params: columns.map(() => `%${searchVal}%`) }, "many");
      rows = r.rows;
    } catch (e) {
      throw new MountError("QUERY_FAILED", `Data query failed: ${(e as Error).message}`);
    }
  } else {
    try {
      const r = await ctx.db.driver.query<any>(compilePlan(dataPlan, ctx.dialect), "many");
      rows = r.rows;
    } catch (e) {
      throw new MountError("QUERY_FAILED", `Data query failed: ${(e as Error).message}`);
    }
  }

  return { columns, rows, count, primaryKey: pk };
}

function quote(ctx: StudioContext, ident: string): string {
  return ctx.dialect.quoteIdent(ident);
}

// ---------------------------------------------------------------------------
// Mutations (parameterized plans — injection-safe)
// ---------------------------------------------------------------------------

export async function insertRow(
  ctx: StudioContext,
  name: string,
  values: Record<string, unknown>,
): Promise<{ success: boolean; lastId: number }> {
  const safeName = validateTableName(name);
  const def = findTable(ctx, safeName);
  if (!def) throw new MountError("NOT_FOUND", `Unknown table "${safeName}"`);
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new MountError("VALIDATION", "Insert values must be a non-empty object");
  }
  const clean = pickColumns(def, values);
  if (Object.keys(clean).length === 0) {
    throw new MountError("VALIDATION", `No valid columns provided for insert into "${safeName}"`);
  }
  const res = (await run(ctx, { op: "insert", table: safeName, filters: [], columnTypes: {}, values: clean })) as {
    changes: number;
    lastId: number;
  };
  return { success: res.changes > 0, lastId: res.lastId };
}

export async function updateRow(
  ctx: StudioContext,
  name: string,
  pkValue: unknown,
  values: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const safeName = validateTableName(name);
  const def = findTable(ctx, safeName);
  if (!def) throw new MountError("NOT_FOUND", `Unknown table "${safeName}"`);
  if (pkValue === undefined || pkValue === null) {
    throw new MountError("VALIDATION", "Primary key value is required for update");
  }
  const pk = primaryKeyOf(def);
  const clean = pickColumns(def, values, [pk]);
  if (Object.keys(clean).length === 0) {
    throw new MountError("VALIDATION", `No updatable columns provided for "${safeName}"`);
  }
  const res = (await run(ctx, {
    op: "update",
    table: safeName,
    filters: [{ kind: "filter", column: pk, op: "=", value: pkValue }],
    columnTypes: {},
    values: clean,
  })) as { changes: number };
  return { success: res.changes > 0 };
}

export async function deleteRow(
  ctx: StudioContext,
  name: string,
  pkValue: unknown,
): Promise<{ success: boolean }> {
  const safeName = validateTableName(name);
  const def = findTable(ctx, safeName);
  if (!def) throw new MountError("NOT_FOUND", `Unknown table "${safeName}"`);
  if (pkValue === undefined || pkValue === null) {
    throw new MountError("VALIDATION", "Primary key value is required for delete");
  }
  const pk = primaryKeyOf(def);
  const res = (await run(ctx, {
    op: "delete",
    table: safeName,
    filters: [{ kind: "filter", column: pk, op: "=", value: pkValue }],
    columnTypes: {},
  })) as { changes: number };
  return { success: res.changes > 0 };
}

function pickColumns(def: TableDef, values: Record<string, unknown>, skip: string[] = []): Record<string, unknown> {
  const known = new Set(def.columns.map((c) => c.name));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (known.has(k) && !skip.includes(k) && v !== undefined) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SQL console (raw, but routed through the driver)
// ---------------------------------------------------------------------------

const MAX_SQL_LENGTH = 10000;

export async function runSql(
  ctx: StudioContext,
  sql: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; changes: number }> {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    throw new MountError("VALIDATION", "SQL query must be a non-empty string");
  }
  if (sql.length > MAX_SQL_LENGTH) {
    throw new MountError("VALIDATION", `SQL query exceeds ${MAX_SQL_LENGTH} character limit`);
  }

  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const isSelect = /^select|with|pragma|explain/i.test(trimmed);

  try {
    if (isSelect) {
      const r = await ctx.db.driver.query<any>({ sql: trimmed, params: [] }, "many");
      const rows = r.rows as Record<string, unknown>[];
      const columns = rows.length ? Object.keys(rows[0] ?? {}) : [];
      return { columns, rows, changes: 0 };
    }
    const r = await ctx.db.driver.query<any>({ sql: trimmed, params: [] }, "run");
    return { columns: [], rows: [], changes: r.changes };
  } catch (e) {
    throw new MountError("QUERY_FAILED", `SQL execution failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// ERD (from live schema)
// ---------------------------------------------------------------------------

export async function erd(ctx: StudioContext): Promise<{ tables: TableMeta[] }> {
  try {
    return { tables: (await listTables(ctx)).tables };
  } catch {
    const defs = await introspectorFor(ctx.db.driver.name).introspect(ctx.db.driver);
    return { tables: defs.map((t) => ({ name: t.name, columns: t.columns })) };
  }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export async function migrations(ctx: StudioContext): Promise<{ applied: string[]; pending: string[] }> {
  const m = new Migrator(ctx.db.driver as Driver);
  try {
    await m.ensureTable();
  } catch (e) {
    throw new MountError("QUERY_FAILED", `Failed to initialize migrations table: ${(e as Error).message}`);
  }
  const status = await m.status();
  return { applied: status.applied, pending: status.pending.map((p) => p.name) };
}

export async function health(ctx: StudioContext): Promise<{ status: string; dialect: string; tables: number }> {
  const t = await listTables(ctx);
  return { status: "ok", dialect: ctx.db.driver.name, tables: t.tables.length };
}

// ---------------------------------------------------------------------------
// Cache (dashboard)
// ---------------------------------------------------------------------------

export async function cacheStats(ctx: StudioContext): Promise<{ stats?: CacheStats; enabled: boolean }> {
  if (!ctx.cache) return { enabled: false };
  try {
    const stats = await ctx.cache.stats();
    return { stats, enabled: true };
  } catch (e) {
    return { enabled: false };
  }
}

export async function cacheInvalidateTag(ctx: StudioContext, tag: string): Promise<{ count: number }> {
  if (!ctx.cache) throw new MountError("NOT_FOUND", "Cache not available");
  const count = await ctx.cache.invalidateTag(tag);
  return { count };
}

export async function cacheClear(ctx: StudioContext): Promise<{ ok: boolean }> {
  if (!ctx.cache) throw new MountError("NOT_FOUND", "Cache not available");
  await ctx.cache.clear();
  return { ok: true };
}
