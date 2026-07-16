// MountSQLI — query optimizer.
// Rule-based rewrites + advisory warnings over the QueryPlan IR.
// Optimization is pure (no DB access); warnings are surfaced to the
// developer via the Studio / `mount analyze`, and to tests.

import type { QueryPlan, Compiled } from "./plan.js";
import type { Dialect } from "./dialect.js";

export interface OptimizeWarning {
  code: "SELECT_STAR" | "MISSING_PK_FILTER" | "LIKE_PREFIX" | "N_PLUS_ONE";
  message: string;
  suggestion: string;
}

export interface OptimizeResult {
  plan: QueryPlan;
  warnings: OptimizeWarning[];
}

export function optimize(plan: QueryPlan): OptimizeResult {
  const warnings: OptimizeWarning[] = [];

  // SELECT * — flag; recommend explicit columns (cheaper, stable over schema drift).
  if (plan.op === "select" && (!plan.columns || plan.columns.length === 0)) {
    warnings.push({
      code: "SELECT_STAR",
      message: "Query selects all columns (*).",
      suggestion: "Select only the columns you need with .select('a','b').",
    });
  }

  // UPDATE/DELETE without a filter — almost always a mistake.
  if ((plan.op === "update" || plan.op === "delete") && plan.filters.length === 0) {
    warnings.push({
      code: "MISSING_PK_FILTER",
      message: `${plan.op.toUpperCase()} has no WHERE clause — will touch every row.`,
      suggestion: "Add a .where() filter, ideally on the primary key.",
    });
  }

  // LIKE without a prefix is non-sargable (can't use an index).
  const leadingWild = plan.filters.find((f) => f.kind === "filter" && f.op === "like" && typeof f.value === "string" && (f.value as string).startsWith("%"));
  if (leadingWild) {
    warnings.push({
      code: "LIKE_PREFIX",
      message: "Leading-wildcard LIKE prevents index usage.",
      suggestion: "Use a prefix match (value starts with a literal) when possible.",
    });
  }

  // The structural signal for N+1 sits at the call site (per-row sub-query),
  // but we surface a heuristic: a select with many IN-list filters on a FK
  // column likely should be a single JOIN. Reported by the planner elsewhere.
  return { plan, warnings };
}

// ---- planner-level helpers (used by analyze / AI cost advisor) ----

export interface IndexSuggestion {
  table: string;
  columns: string[];
  reason: string;
}

/** Suggest indexes from a set of observed query plans (cheap heuristic). */
export function suggestIndexes(plans: QueryPlan[]): IndexSuggestion[] {
  const freq = new Map<string, { table: string; col: string; count: number }>();
  // Collect filter columns for index suggestions, skipping OR nodes.
  const collectColumns = (filters: import("./plan.js").FilterNode[], table: string) => {
    for (const f of filters) {
      if (f.kind === "and" || f.kind === "or") { collectColumns(f.filters, table); continue; }
      if (f.kind === "subquery") { if (f.plan) collectColumns(f.plan.filters, table); continue; }
      if (!f.column) continue;
      const key = `${table}.${f.column}`;
      const e = freq.get(key) ?? { table, col: f.column, count: 0 };
      e.count++;
      freq.set(key, e);
    }
  };
  for (const p of plans) {
    collectColumns(p.filters, p.table);
  }
  return [...freq.values()]
    .filter((e) => e.count >= 2)
    .map((e) => ({ table: e.table, columns: [e.col], reason: `Filtered ${e.count} times across observed queries.` }));
}

// Compile + track the cache key (prepared-statement reuse).
export function planCacheKey(compiled: Compiled, dialect: Dialect): string {
  return dialect.paramStyle === "numbered" ? compiled.sql.replace(/\$\d+/g, "?") : compiled.sql;
}
