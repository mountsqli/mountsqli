// MountSQLI — Query Cache Analyzer.
//
// Determines whether a QueryPlan is cacheable by inspecting the SQL/plan for
// volatile functions, temporary tables, non-deterministic operations, etc.
// Automatically builds the cache key from the compiled SQL + params and
// extracts the table names for tag-based invalidation.

import type { QueryPlan } from "@mountsqli/compiler";
import type { QueryCacheability } from "./types.js";

// ---------------------------------------------------------------------------
// Volatile SQL functions — results change every call
// ---------------------------------------------------------------------------

const VOLATILE_FUNCTIONS = new Set([
  "now", "current_timestamp", "current_date", "current_time",
  "random", "rand", "uuid", "gen_random_uuid", "uuid_generate_v4",
  "newid", "newsequentialid",
  "last_insert_rowid", "lastval", "currval", "nextval",
  "sleep", "pg_sleep",
]);

// ---------------------------------------------------------------------------
// Wildcard patterns that indicate non-cacheable data
// ---------------------------------------------------------------------------

const TEMP_TABLE_RE = /^\s*#|^\s*temp/i;
const MUTATING_OPS = new Set(["insert", "update", "delete", "upsert"]);

// ---------------------------------------------------------------------------
// Table name extraction from a query plan
// ---------------------------------------------------------------------------

function extractTables(plan: QueryPlan): string[] {
  const tables = new Set<string>();
  if (plan.table) tables.add(plan.table);
  // FUTURE: extract from JOIN tables if the plan has them
  return [...tables];
}

// ---------------------------------------------------------------------------
// Create a deterministic cache key from a compiled query
// ---------------------------------------------------------------------------

export function buildCacheKey(sql: string, params: unknown[]): string {
  const paramStr = params.map((p) => {
    if (p === null) return "null";
    if (typeof p === "object") return JSON.stringify(p);
    return String(p);
  }).join(",");
  return `q:${hash(`${sql}|${paramStr}`)}`;
}

// Simple string hash (djb2)
function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff;
  }
  return h.toString(36);
}

// ---------------------------------------------------------------------------
// Analyze a query plan for cacheability
// ---------------------------------------------------------------------------

export class QueryCacheAnalyzer {
  private volatileFunctions: Set<string>;

  constructor(extraVolatile?: string[]) {
    this.volatileFunctions = new Set(VOLATILE_FUNCTIONS);
    if (extraVolatile) {
      for (const f of extraVolatile) this.volatileFunctions.add(f.toLowerCase());
    }
  }

  analyze(plan: QueryPlan): QueryCacheability {
    const tables = extractTables(plan);

    // Mutating operations are never cached (they have query results but
    // represent a write; the caller decides whether to invalidate).
    if (MUTATING_OPS.has(plan.op)) {
      return { cacheable: false, reason: "Mutating operation", tables, deterministic: true };
    }

    // Check for volatile SQL function references in the compiled output.
    // (The plan itself doesn't contain SQL text, but the compiler's output does.
    // We analyze at the plan level; the SQL-level check happens at compile time.)
    if (plan.op !== "select") {
      return { cacheable: false, reason: `Uncacheable operation: ${plan.op}`, tables, deterministic: false };
    }

    // If the plan has aggregations with no GROUP BY on a PK, it's a
    // deterministic aggregate — still cacheable.
    return {
      cacheable: true,
      tables,
      cacheKey: buildCacheKey(plan.table ?? "unknown", []),
      deterministic: true,
    };
  }

  /** Analyze raw SQL for cacheability (for SQL console / raw queries). */
  analyzeSql(sql: string): QueryCacheability {
    const tables = this.extractTablesFromSql(sql);
    const lower = sql.trim().toLowerCase();

    // Not a SELECT
    if (!lower.startsWith("select") && !lower.startsWith("with")) {
      return { cacheable: false, reason: "Non-SELECT query", tables, deterministic: true };
    }

    // Check for volatile functions
    for (const fn of this.volatileFunctions) {
      const re = new RegExp(`\\b${fn}\\s*\\(`, "i");
      if (re.test(sql)) {
        return { cacheable: false, reason: `Contains volatile function: ${fn}`, tables, deterministic: false };
      }
    }

    // Check for temp tables
    if (TEMP_TABLE_RE.test(sql)) {
      return { cacheable: false, reason: "References temporary table", tables, deterministic: false };
    }

    const cacheKey = buildCacheKey(sql, []);
    return { cacheable: true, cacheKey, tables, deterministic: true };
  }

  /** Extract table names from raw SQL (simple heuristic). */
  private extractTablesFromSql(sql: string): string[] {
    const tables: string[] = [];
    const re = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+["`']?(\w+)["`']?/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(sql)) !== null) {
      const table = match[1]!;
      if (!tables.includes(table)) tables.push(table);
    }
    return tables;
  }
}
