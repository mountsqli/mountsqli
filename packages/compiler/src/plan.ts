// MountSQLI — QueryPlan IR (intermediate representation).
// A query is plain data. That makes it serializable (edge<->server),
// optimizable, cacheable, and zero-cost to construct.

import type { ColumnType } from "@mountsqli/schema";
import { sqliteDialect } from "./dialect.js";

export type Comparator = "=" | ">" | "<" | ">=" | "<=" | "!=" | "like" | "in" | "is" | "is not" | "between";

export type FilterNode = {
  kind: "filter";
  column: string;
  op: Comparator;
  value: unknown;
} | {
  /** AND-group: all sub-filters must match. */
  kind: "and";
  filters: FilterNode[];
} | {
  /** OR-group: any matching sub-filter makes the row visible. */
  kind: "or";
  filters: FilterNode[];
} | {
  /** EXISTS / NOT EXISTS / IN / NOT IN subquery. */
  kind: "subquery";
  column?: string;
  op: "exists" | "not exists" | "in" | "not in";
  /** The sub-query plan to embed. */
  plan: QueryPlan;
};

export interface JoinDef {
  type: "inner" | "left" | "right";
  table: string;
  /** Optional alias — required for self-joins. */
  alias?: string;
  on: { left: string; right: string };
}

/** Window function definition. */
export interface WindowDef {
  fn: "row_number" | "rank" | "dense_rank" | "lag" | "lead" | "first_value" | "last_value" | "ntile" | "count" | "sum" | "avg";
  column?: string; // column the function operates on (empty for row_number)
  alias: string;
  partitionBy?: string[];
  orderBy?: { column: string; dir: "asc" | "desc" }[];
  /** For frame clause e.g. ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW */
  frame?: string;
}

/** ON CONFLICT / upsert clause. */
export type OnConflict = {
  action: "nothing" | "update";
  constraint?: string | string[];
  /** Columns+values to set for DO UPDATE. */
  set?: Record<string, unknown>;
};

/** Full-text search descriptor. */
export interface FtsDef {
  /** The search mode. */
  mode: "fts5" | "tsvector" | "fulltext";
  /** Columns to search against. */
  columns: string[];
  /** The search query string. */
  query: string;
  /** Optional table alias for the FTS virtual table (FTS5). */
  tableAlias?: string;
}

/** JSON operation descriptor. */
export type JsonOp = {
  kind: "extract" | "set" | "remove" | "agg" | "object" | "array";
  column?: string;
  /** Path expression (e.g. "$.name" or simply the key). */
  path?: string;
  alias?: string;
  /** Value to set. */
  value?: unknown;
  /** Sub-operations for json_object / json_agg. */
  fields?: { key: string; value: string }[];
};

/** Aggregate expression in SELECT. */
export interface AggregateDef {
  fn: "count" | "sum" | "avg" | "min" | "max";
  column?: string; // omit for count(*)
  alias: string;
  distinct?: boolean;
}

export type QueryPlan = {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  columns?: string[]; // undefined => SELECT *
  filters: FilterNode[];
  joins?: JoinDef[];
  orderBy?: { column: string; dir: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
  values?: Record<string, unknown> | Record<string, unknown>[]; // insert / update (array = multi-row)
  returning?: string[]; // SELECT * FROM ... WHERE id = lastval when unsupported
  columnTypes?: Record<string, ColumnType>; // driver uses this to decode
  /** RLS: when true the query is forced to match nothing (WHERE 1=0). */
  deny?: boolean;
  /** SELECT DISTINCT. */
  distinct?: boolean;
  /** Postgres DISTINCT ON (columns). When set, distinct is implied. */
  distinctOn?: string[];
  /** GROUP BY columns. */
  groupBy?: string[];
  /** HAVING filter — applied after GROUP BY, uses the same FilterNode structure. */
  having?: FilterNode[];
  /** CTE (WITH clause) — named sub-queries at the start of the statement. */
  with?: { name: string; columns?: string[]; query: QueryPlan }[];
  /** Set operations — UNION / UNION ALL / INTERSECT / EXCEPT appended after the main query. */
  unions?: { type: "union" | "union all" | "intersect" | "except"; all?: boolean; query: QueryPlan }[];
  /** Window functions (SELECT only). */
  window?: WindowDef[];
  /** ON CONFLICT clause (INSERT only). */
  onConflict?: OnConflict;
  /** Full-text search clause. */
  fts?: FtsDef;
  /** JSON operations. */
  jsonOps?: JsonOp[];
  /** Aggregate expressions in SELECT. */
  aggregates?: AggregateDef[];
  /** Subquery in FROM — replaces `table` as the source. */
  fromSubquery?: { plan: QueryPlan; alias: string };
  /** Row-level locking (SELECT ... FOR UPDATE/SHARE). */
  lock?: { mode: "update" | "share" | "no key update" | "key share"; skipLocked?: boolean; nowait?: boolean };
  /** Raw SQL expressions appended to the WHERE clause. */
  rawFilters?: { expr: string; params: unknown[] }[];
  /** Raw SQL expressions in SELECT (e.g. selectExpr — NOT quoted, passed through). */
  selectExprs?: { sql: string; alias: string }[];
  /** RLS enforcement marker. Set by `applyPolicy`/`applyPolicies`. When a Db
   * runs in `enforceRls` mode, executing a query whose target table has a
   * registered policy but `rlsApplied` is false throws (issue 003). */
  rlsApplied?: boolean;
  /** Opt out of RLS enforcement for this builder (`.unsafe()`). Only valid in
   * `enforceRls` mode; bypasses the missing-policy guard. */
  rlsUnsafe?: boolean;
};

export function emptyPlan(table: string, op: QueryPlan["op"] = "select"): QueryPlan {
  return { op, table, filters: [] };
}

// ---- compile plan -> SQL (parameterized, never string-concatenates values) ----

export interface Compiled {
  sql: string;
  params: unknown[];
  columnTypes?: Record<string, ColumnType>;
  /** Columns to return for RETURNING emulation on INSERT (MySQL). Populated by compilePlan when dialect doesn't support RETURNING. */
  returning?: string[];
  /** Table name the query targets — used by RETURNING emulation. */
  table?: string;
}

import type { Dialect } from "./dialect.js";

export function compilePlan(plan: QueryPlan, dialect: Dialect = sqliteDialect): Compiled {
  const params: unknown[] = [];
  const q = dialect.quoteIdent;

  // Validate filter columns against the schema (columnTypes).
  // Only validate when columnTypes has at least one key (meaning a populated schema).
  if (plan.columnTypes && Object.keys(plan.columnTypes).length > 0) {
    const validCols = new Set(Object.keys(plan.columnTypes));
    const checkCol = (col: string) => {
      if (!validCols.has(col)) {
        throw new Error(`MountSQLI: column "${col}" does not exist on table "${plan.table}"`);
      }
    };
    const walk = (filters: FilterNode[]) => {
      for (const f of filters) {
        if (f.kind === "and" || f.kind === "or") { walk(f.filters); continue; }
        if (f.kind === "subquery") { if (f.column) checkCol(f.column); continue; }
        checkCol(f.column);
      }
    };
    walk(plan.filters);
  }

  // Compile a single filter node to SQL, pushing params as side-effect.
  // Helper: quote ident but pass * through unquoted (for RETURNING *).
  const qStar = (col: string) => col === "*" ? "*" : q(col);

  const compileFilter = (f: FilterNode): string => {
    if (f.kind === "and") {
      const subs = f.filters.map(compileFilter).join(" AND ");
      return `(${subs})`;
    }
    if (f.kind === "or") {
      const subs = f.filters.map(compileFilter).join(" OR ");
      return `(${subs})`;
    }
    if (f.kind === "subquery") {
      // Recursively compile the sub-query plan.
      const sub = compilePlan(f.plan, dialect);
      params.push(...sub.params);
      if (f.op === "exists" || f.op === "not exists") {
        return `${f.op.toUpperCase()} (${sub.sql})`;
      }
      // IN / NOT IN (subquery)
      const col = f.column ? q(f.column) : "";
      return `${col} ${f.op.toUpperCase()} (${sub.sql})`;
    }
    if (f.op === "in") {
      const arr = Array.isArray(f.value) ? f.value : [f.value];
      const start = params.length;
      params.push(...arr);
      const holes = arr.map((_, i) => dialect.param(start + 1 + i)).join(", ");
      return `${q(f.column)} IN (${holes})`;
    }
    if (f.op === "between") {
      const arr = Array.isArray(f.value) ? f.value : [f.value, f.value];
      const start = params.length;
      params.push(arr[0], arr[1]);
      return `${q(f.column)} BETWEEN ${dialect.param(start + 1)} AND ${dialect.param(start + 2)}`;
    }
    params.push(f.value);
    return `${q(f.column)} ${f.op.toUpperCase()} ${dialect.param(params.length)}`;
  };

  // Build a WHERE clause, pushing its params in the order they appear.
  const buildWhere = (): string => {
    const parts = plan.filters.map(compileFilter);
    if (plan.rawFilters) {
      for (const rf of plan.rawFilters) {
        params.push(...rf.params);
        parts.push(rf.expr);
      }
    }
    if (!parts.length) return "";
    return ` WHERE ${parts.join(" AND ")}`;
  };

  // Helper: compile a window function to SQL.
  const compileWindow = (w: WindowDef): string => {
    const fnName = w.fn.toUpperCase();
    let args = w.column ? q(w.column) : "";
    // count(*) needs * not column
    if (w.fn === "count") args = args || "*";
    let out = `${fnName}(${args}) OVER (`;
    if (w.partitionBy?.length) out += `PARTITION BY ${w.partitionBy.map(q).join(", ")}`;
    if (w.orderBy?.length) {
      if (w.partitionBy?.length) out += " ";
      out += `ORDER BY ${w.orderBy.map((o) => `${q(o.column)} ${o.dir.toUpperCase()}`).join(", ")}`;
    }
    if (w.frame) out += ` ${w.frame}`;
    out += `) AS ${q(w.alias)}`;
    return out;
  };

  // Helper: compile FTS to SQL.
  const compileFts = (fts: FtsDef): string => {
    if (fts.mode === "fts5") {
      // SQLite FTS5: table MATCH ?
      const tbl = fts.tableAlias ?? q(plan.table);
      params.push(fts.query);
      return `${tbl} MATCH ${dialect.param(params.length)}`;
    }
    if (fts.mode === "tsvector") {
      // Postgres: to_tsvector(columns) @@ plainto_tsquery(?)
      const cols = fts.columns.map(q).join(" || ' ' || ");
      params.push(fts.query);
      return `to_tsvector(${cols}) @@ plainto_tsquery(${dialect.param(params.length)})`;
    }
    // MySQL FULLTEXT: MATCH (columns) AGAINST (?)
    const cols = fts.columns.map(q).join(", ");
    params.push(fts.query);
    return `MATCH (${cols}) AGAINST (${dialect.param(params.length)})`;
  };

  // Helper: compile JSON ops to SELECT expressions.
  const compileJsonOps = (ops: JsonOp[]): string[] => {
    return ops.map((op) => {
      switch (op.kind) {
        case "extract": {
          const col = op.column ? q(op.column) : "";
          const path = op.path ? `, ${op.path}` : "";
          const alias = op.alias ? ` AS ${q(op.alias)}` : "";
          // json_extract is universal (sqlite, pg, mysql all support it)
          return `json_extract(${col}${path})${alias}`;
        }
        case "set":
          params.push(op.value);
          return `json_set(${q(op.column!)}, ${op.path!}, ${dialect.param(params.length)}) AS ${q(op.alias!)}`;
        case "remove":
          return `json_remove(${q(op.column!)}, ${op.path!}) AS ${q(op.alias!)}`;
        case "agg":
          return `json_agg(${q(op.column!)}) AS ${q(op.alias!)}`;
        case "object": {
          if (!op.fields?.length) return "json_object()";
          const pairs: string[] = [];
          for (const f of op.fields) {
            pairs.push(`'${f.key}'`, q(f.value));
          }
          return `json_object(${pairs.join(", ")}) AS ${q(op.alias ?? "obj")}`;
        }
        case "array":
          return `json_array(${op.column ? q(op.column) : ""}) AS ${q(op.alias ?? "arr")}`;
        default:
          return "";
      }
    });
  };

  if (plan.op === "select") {
    const distinct = plan.distinctOn?.length
      ? `DISTINCT ON (${plan.distinctOn.map(q).join(", ")}) `
      : plan.distinct ? "DISTINCT " : "";
    let cols = "*";
    if (plan.columns && plan.columns.length) {
      cols = plan.columns.map(q).join(", ");
    }
    // Window functions add columns to SELECT.
    const windowParts = plan.window?.map(compileWindow) ?? [];
    // JSON ops add to SELECT.
    const jsonParts = plan.jsonOps ? compileJsonOps(plan.jsonOps) : [];
    // Aggregate cols add to SELECT.
    const aggParts = (plan.aggregates ?? []).map((a) => {
      const distinct = a.distinct ? "DISTINCT " : "";
      const col = a.fn === "count" && !a.column ? "*" : (a.column ? q(a.column) : "*");
      return `${a.fn.toUpperCase()}(${distinct}${col}) AS ${q(a.alias)}`;
    });
    // Raw SQL expressions in SELECT (selectExpr — NOT quoted, passed through).
    const selectExprParts = (plan.selectExprs ?? []).map((e) => `${e.sql} AS ${q(e.alias)}`);
    const extraCols = [...windowParts, ...jsonParts, ...aggParts, ...selectExprParts];
    if (extraCols.length) {
      cols = cols === "*" ? extraCols.join(", ") : cols + ", " + extraCols.join(", ");
    }

    // RLS short-circuit: a denied policy forces the query to match nothing.
    if (plan.deny) {
      return { sql: `SELECT ${distinct}${cols} FROM ${q(plan.table)} WHERE 1=0`, params: [], columnTypes: plan.columnTypes };
    }
    // Build JOIN clause.
    const joinClause = (plan.joins ?? [])
      .map((j) => {
        const joinType = j.type === "inner" ? "JOIN" : `${j.type.toUpperCase()} JOIN`;
        const alias = j.alias ? ` AS ${q(j.alias)}` : "";
        return ` ${joinType} ${q(j.table)}${alias} ON ${q(j.on.left)} = ${q(j.on.right)}`;
      })
      .join("");

    // Build FROM — subquery, FTS source, or bare table.
    let fromSource: string;
    if (plan.fromSubquery) {
      const sub = compilePlan(plan.fromSubquery.plan, dialect);
      params.push(...sub.params);
      fromSource = `(${sub.sql}) AS ${q(plan.fromSubquery.alias)}`;
    } else {
      fromSource = q(plan.table);
    }
    let ftsFilter = "";
    if (plan.fts) {
      if (plan.fts.mode === "fts5") {
        // FTS5: FROM fts_table AS alias, JOIN real table on rowid
        const alias = plan.fts.tableAlias ?? "fts";
        const ftsTable = plan.fts.tableAlias ?? `${plan.table}_fts`;
        fromSource = `${ftsTable} AS ${q(alias)} JOIN ${q(plan.table)} ON ${q(alias)}.rowid = ${q(plan.table)}.rowid`;
      }
      ftsFilter = compileFts(plan.fts);
    }

    let sql = `SELECT ${distinct}${cols} FROM ${fromSource}${joinClause}${buildWhere()}`;
    // Append FTS filter as extra WHERE if not already included via buildWhere
    if (ftsFilter && !plan.filters.length) {
      sql += " WHERE " + ftsFilter;
    } else if (ftsFilter) {
      sql += " AND " + ftsFilter;
    }
    if (plan.groupBy?.length) {
      sql += " GROUP BY " + plan.groupBy.map(q).join(", ");
    }
    if (plan.having?.length) {
      sql += " HAVING " + plan.having.map(compileFilter).join(" AND ");
    }
    if (plan.orderBy?.length) {
      sql += " ORDER BY " + plan.orderBy.map((o) => `${q(o.column)} ${o.dir.toUpperCase()}`).join(", ");
    }
    if (plan.limit !== undefined) sql += ` LIMIT ${plan.limit}`;
    if (plan.offset !== undefined) sql += ` OFFSET ${plan.offset}`;
    // Locking clause
    if (plan.lock) {
      sql += ` FOR ${plan.lock.mode.toUpperCase().replace(/\s+/g, " ")}`;
      if (plan.lock.nowait) sql += " NOWAIT";
      if (plan.lock.skipLocked) sql += " SKIP LOCKED";
    }
    // Build UNION clause — sub-queries inherit parent's columns when they have none
    const unionClause = (plan.unions ?? [])
      .map((u) => {
        const subQuery = { ...u.query };
        if (!subQuery.columns?.length && plan.columns?.length) {
          subQuery.columns = [...plan.columns];
        }
        const sub = compilePlan(subQuery, dialect);
        const subParams = sub.params;
        // Renumber sub-query's $N params to account for parent params already pushed.
        // Sub-query was compiled with its own param numbering starting at $1,
        // but in the combined SQL it needs to start at params.length + 1.
        const offset = params.length;
        let subSql = sub.sql;
        if (dialect.param(0) !== "?") {
          // Numbered param style ($N, :N) — shift by offset
          subSql = subSql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + offset}`);
        }
        params.push(...subParams);
        const keyword = u.type === "union" || u.type === "union all"
          ? `UNION${u.type === "union all" ? " ALL" : ""}`
          : u.type.toUpperCase();
        return ` ${keyword} (${subSql})`;
      })
      .join("");
    // Build CTE (WITH) clause — prepend if present
    let withClause = "";
    if (plan.with?.length) {
      const cteParts = plan.with.map((w) => {
        const sub = compilePlan(w.query, dialect);
        params.push(...sub.params);
        const cols = w.columns?.length ? ` (${w.columns.join(", ")})` : "";
        return `${q(w.name)}${cols} AS (${sub.sql})`;
      });
      withClause = `WITH ${cteParts.join(", ")} `;
    }
    sql = withClause + sql + unionClause;
    return { sql, params, columnTypes: plan.columnTypes };
  }

  if (plan.op === "insert") {
    // Multi-row INSERT: values can be an array. Normalize to array.
    const rows = Array.isArray(plan.values) ? plan.values : [plan.values ?? {}];
    const keys = Object.keys(rows[0] ?? {});

    const start = params.length;
    for (const row of rows) {
      for (const k of keys) {
        params.push((row as any)[k]);
      }
    }
    // Build per-row inline param holes with correct positional indices.
    const colCount = keys.length;
    let paramIdx = start + 1;
    const rowHolesList: string[] = [];
    for (let ri = 0; ri < rows.length; ri++) {
      const holes: string[] = [];
      for (let ci = 0; ci < colCount; ci++) {
        holes.push(dialect.param(paramIdx++));
      }
      rowHolesList.push(`(${holes.join(", ")})`);
    }
    const valuesClause = rowHolesList.join(", ");

    // ON CONFLICT / upsert clause
    let onConflictClause = "";
    if (plan.onConflict) {
      const oc = plan.onConflict;
      if (oc.constraint) {
        const constraint = Array.isArray(oc.constraint) ? oc.constraint.map(q).join(", ") : q(oc.constraint);
        if (oc.action === "nothing") {
          onConflictClause = ` ON CONFLICT (${constraint}) DO NOTHING`;
        } else if (oc.action === "update" && oc.set) {
          const setKeys = Object.keys(oc.set);
          const setParams = setKeys.map((k) => {
            params.push((oc.set as any)[k]);
            return `${q(k)} = ${dialect.param(params.length)}`;
          }).join(", ");
          onConflictClause = ` ON CONFLICT (${constraint}) DO UPDATE SET ${setParams}`;
        }
      } else {
        if (oc.action === "nothing") {
          onConflictClause = " ON CONFLICT DO NOTHING";
        }
      }
    }

    const returning = dialect.supportsReturning && plan.returning?.length
      ? ` RETURNING ${plan.returning.map(qStar).join(", ")}`
      : "";
    return {
      sql: `INSERT INTO ${q(plan.table)} (${keys.map(q).join(", ")}) VALUES ${valuesClause}${onConflictClause}${returning}`,
      params,
      columnTypes: plan.columnTypes,
      table: plan.table,
      // Propagate returning for drivers that need to emulate it (MySQL).
      returning: !dialect.supportsReturning ? plan.returning : undefined,
    };
  }

  if (plan.op === "update") {
    const vals = plan.values ?? {};
    const keys = Object.keys(vals);
    const start = params.length;
    params.push(...keys.map((k) => (vals as any)[k]));
    const sets = keys.map((k, i) => `${q(k)} = ${dialect.param(start + 1 + i)}`).join(", ");
    // WHERE params are appended AFTER the SET params, matching SQL order.
    const where = buildWhere();
    const returning = dialect.supportsReturning && plan.returning?.length
      ? ` RETURNING ${plan.returning.map(qStar).join(", ")}`
      : "";
    return { sql: `UPDATE ${q(plan.table)} SET ${sets}${where}${returning}`, params, columnTypes: plan.columnTypes, table: plan.table, returning: !dialect.supportsReturning ? plan.returning : undefined };
  }

  // delete
  const returningDel = dialect.supportsReturning && plan.returning?.length
    ? ` RETURNING ${plan.returning.map(qStar).join(", ")}`
    : "";
  return { sql: `DELETE FROM ${q(plan.table)}${buildWhere()}${returningDel}`, params, columnTypes: plan.columnTypes, table: plan.table, returning: !dialect.supportsReturning ? plan.returning : undefined };
}

export function planKey(plan: QueryPlan, dialect: Dialect = sqliteDialect): string {
  // Stable cache key for prepared-statement reuse.
  return compilePlan(plan, dialect).sql;
}
