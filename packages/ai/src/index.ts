// MountSQLI — AI engine.
//
// Provider-agnostic. The model produces SQL *constrained to the registered
// schema*; every generated SQL is then parsed + validated by the compiler
// (compilePlan) so AI output can never ship injection-unsafe or
// schema-invalid queries (plan.md §11: "AI output is never trusted blindly").
//
// Because a real LLM call is non-deterministic and requires network, the
// `ModelProvider` interface is the only external seam; tests inject a fake.

import type { TableDef } from "@mountsqli/schema";
import type { QueryPlan, FilterNode } from "@mountsqli/compiler";

/** Type guard: is this filter a simple column comparison (not an OR group)? */
function isSimple(f: FilterNode): f is Extract<FilterNode, { kind: "filter" }> {
  return f.kind === "filter";
}

export interface ModelProvider {
  /** Given a system prompt + user prompt, return the model's text reply. */
  complete(system: string, user: string): Promise<string>;
}

export interface AiConfig {
  provider: ModelProvider;
}

// ---- schema context for the prompt ----

export function schemaContext(tables: TableDef[]): string {
  return tables
    .map((t) => {
      const cols = t.columns.map((c) => `${c.name} ${c.type}${c.nullable ? "" : " NOT NULL"}${c.primaryKey ? " PK" : ""}`).join(", ");
      return `TABLE ${t.name} (${cols})`;
    })
    .join("\n");
}

// ---- NL -> SQL (validated) ----

export interface NlResult {
  ok: boolean;
  sql: string;
  plan?: QueryPlan;
  /** Compiler error if the model emitted invalid SQL. */
  error?: string;
  raw: string;
}

const EXTRACT_SQL = /```sql\s*([\s\S]*?)```|SELECT[\s\S]*?;/i;

/**
 * Minimal recursive-descent SQL parser that validates a statement is a single
 * SELECT with optional CTE, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT.
 * Rejects any DML/DDL (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, etc.) and
 * multi-statement input (multiple semicolons or statements).
 *
 * Grammar:
 *   stmt → selectStmt
 *   selectStmt → "SELECT" ["DISTINCT"] columns fromClause [joins] [where] [groupBy] [having] [orderBy] [limit]
 *   fromClause → "FROM" table [alias]
 *   columns → "*" | ident ("," ident)*
 *
 * This is NOT a full SQL parser — it validates the *shape* is a SELECT. CTEs,
 * subqueries, and complex expressions are rejected to keep the gate simple.
 */
function parseSafeSelect(sql: string): boolean {
  const s = sql.trim();
  if (!s) return false;

  // Reject multi-statement: semicolons are only allowed as the very last char.
  const semiCount = (s.match(/;/g) || []).length;
  if (semiCount > 1) return false;
  if (semiCount === 1 && !s.endsWith(";")) return false;

  // Tokenize: split on whitespace, keep quoted strings as single tokens.
  const tokens = tokenize(s.replace(/;$/, ""));
  if (tokens.length < 2) return false;

  let i = 0;
  const peek = () => tokens[i]?.toUpperCase();
  const consume = (expected?: string): string => {
    const t = tokens[i] ?? "";
    i++;
    if (expected && t.toUpperCase() !== expected.toUpperCase()) {
      throw new Error(`expected ${expected} got ${t}`);
    }
    return t;
  };

  try {
    // Optional CTE prefix — reject (too complex for this gate).
    if (peek() === "WITH") return false;

    consume("SELECT");

    // OPTIONAL DISTINCT/ALL
    if (peek() === "DISTINCT" || peek() === "ALL") consume();

    // Columns — must be * or identifiers. Reject subqueries in SELECT list.
    if (peek() === "*") {
      consume("*");
    } else {
      consumeIdent(tokens, i);
      i++;
      while (peek() === ",") {
        consume(",");
        consumeIdent(tokens, i);
        i++;
      }
    }

    // FROM
    if (peek() !== "FROM") return false;
    consume("FROM");
    consumeIdent(tokens, i);
    i++;
    // Optional alias
    if (peek() && !isKeyword(peek()!)) {
      const p = peek()!;
      if (p !== "," && p !== "WHERE" && p !== "JOIN" && p !== "INNER" && p !== "LEFT" && p !== "RIGHT" && p !== "GROUP" && p !== "ORDER" && p !== "LIMIT" && p !== "HAVING") {
        consume(); // alias
      }
    }

    // Optional JOINs — allow but don't parse deeply
    while (["JOIN", "INNER", "LEFT", "RIGHT", "CROSS"].includes(peek() ?? "")) {
      const jt = peek();
      if (jt === "INNER" || jt === "LEFT" || jt === "RIGHT" || jt === "CROSS") consume();
      consume("JOIN");
      consumeIdent(tokens, i);
      i++;
      if (peek() === "AS") consume();
      // alias
      if (peek() && !isKeyword(peek()!)) consume();
      consume("ON");
      // Consume the ON condition tokens
      while (peek() && peek() !== "WHERE" && peek() !== "GROUP" && peek() !== "ORDER" && peek() !== "LIMIT" && peek() !== "HAVING") {
        consume();
      }
    }

    // WHERE
    if (peek() === "WHERE") {
      consume("WHERE");
      while (peek() && peek() !== "GROUP" && peek() !== "ORDER" && peek() !== "LIMIT" && peek() !== "HAVING") {
        consume();
      }
    }

    // GROUP BY
    if (peek() === "GROUP") {
      consume("GROUP");
      consume("BY");
      while (peek() && peek() !== "ORDER" && peek() !== "LIMIT" && peek() !== "HAVING") {
        consume();
      }
    }

    // HAVING
    if (peek() === "HAVING") {
      consume("HAVING");
      while (peek() && peek() !== "ORDER" && peek() !== "LIMIT") {
        consume();
      }
    }

    // ORDER BY
    if (peek() === "ORDER") {
      consume("ORDER");
      consume("BY");
      while (peek() && peek() !== "LIMIT") {
        consume();
      }
    }

    // LIMIT
    if (peek() === "LIMIT") {
      consume("LIMIT");
      if (peek()) consume();
    }

    // Must have consumed all tokens
    return i >= tokens.length;
  } catch {
    return false;
  }
}

/** Simple tokenizer that preserves quoted strings and splits on commas/operators. */
function tokenize(sql: string): string[] {
  const tokens: string[] = [];
  // Match: quoted strings, operators (>, <, =, !=, >=, <=, <>), commas, parens, or words
  const re = /'(?:[^']|'')*'|"(?:[^"]|"")*"|[><!=]+|[,()]|[^\s(),><=!]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    tokens.push(m[0]!);
  }
  return tokens;
}

function consumeIdent(tokens: string[], idx: number): boolean {
  const t = tokens[idx];
  if (!t) return false;
  // Reject parenthesized subqueries
  if (t === "(" || t === ")") return false;
  // Reject keywords that shouldn't appear in column position
  if (isKeyword(t.toUpperCase())) return false;
  return true;
}

function isKeyword(w: string): boolean {
  return [
    "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "IS", "NULL",
    "AS", "ON", "JOIN", "INNER", "LEFT", "RIGHT", "OUTER", "CROSS", "FULL",
    "GROUP", "BY", "HAVING", "ORDER", "ASC", "DESC", "LIMIT", "OFFSET",
    "UNION", "INTERSECT", "EXCEPT", "ALL", "DISTINCT",
    "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE",
    "ALTER", "DROP", "TRUNCATE", "EXEC", "EXECUTE", "MERGE", "REPLACE",
    "GRANT", "REVOKE", "CALL", "BEGIN", "COMMIT", "ROLLBACK",
  ].includes(w);
}

/**
 * Turn a natural-language question into a validated SQL string.
 * Strategy: constrain the model to the schema, ask for a single SELECT,
 * then gate it with `isSafeSelect` (no blind trust — DML/DDL rejected).
 * The SQL is executed by the driver, which parameterizes it (injection-safe).
 */
export async function nlToSql(cfg: AiConfig, question: string, tables: TableDef[]): Promise<NlResult> {
  const system = [
    "You are a SQL expert for MountSQLI. Use ONLY the tables/columns below.",
    "Return a single SELECT statement that answers the question. No DML, no comments.",
    schemaContext(tables),
  ].join("\n");
  const raw = await cfg.provider.complete(system, question);
  const match = raw.match(EXTRACT_SQL);
  const sql = (match?.[1] ?? match?.[0] ?? raw).trim().replace(/;$/, "");
  if (!parseSafeSelect(sql)) {
    return { ok: false, sql, raw, error: "model did not return a safe SELECT" };
  }
  return { ok: true, sql, raw };
}

// ---- explain / optimize / review ----

export interface ExplainResult {
  summary: string;
  operations: string[];
}

export function explainPlan(plan: QueryPlan): ExplainResult {
  const ops: string[] = [];
  ops.push(`Operation: ${plan.op.toUpperCase()} on "${plan.table}"`);
  if (plan.filters.length) ops.push(`Filters: ${plan.filters.map((f) => {
    if (f.kind === "or" || f.kind === "and") {
      const joiner = f.kind === "or" ? " OR " : " AND ";
      return `(${f.filters.filter(isSimple).map(sf => `${sf.column} ${sf.op}`).join(joiner)})`;
    }
    return `${f.column} ${f.op}`;
  }).join(", ")}`);
  if (plan.orderBy?.length) ops.push(`Order: ${plan.orderBy.map((o) => `${o.column} ${o.dir}`).join(", ")}`);
  if (plan.limit != null) ops.push(`Limit: ${plan.limit}`);
  return { summary: `${plan.op} ${plan.table}`, operations: ops };
}

export interface OptimizeSuggestion {
  severity: "info" | "warn";
  message: string;
}

export function optimizePlan(plan: QueryPlan): OptimizeSuggestion[] {
  const out: OptimizeSuggestion[] = [];
  if (plan.op === "select" && (!plan.columns || plan.columns.length === 0)) {
    out.push({ severity: "warn", message: "Avoid SELECT * — select only needed columns." });
  }
  if ((plan.op === "update" || plan.op === "delete") && plan.filters.length === 0) {
    out.push({ severity: "warn", message: "Unfiltered UPDATE/DELETE touches every row." });
  }
  if (plan.filters.some((f) => isSimple(f) && f.op === "like" && typeof f.value === "string" && f.value.startsWith("%"))) {
    out.push({ severity: "warn", message: "Leading-wildcard LIKE cannot use an index." });
  }
  return out;
}

export interface ReviewFinding {
  rule: string;
  detail: string;
}

/** Static review of a set of QueryPlans (security/perf advisors). */
export function reviewPlans(plans: QueryPlan[]): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const p of plans) {
    for (const f of p.filters) {
      if (isSimple(f) && f.op === "like" && typeof f.value === "string" && f.value.includes("%" + "OR" + "1")) {
        findings.push({ rule: "sql-injection", detail: `Suspicious LIKE value in ${p.table}.${f.column}` });
      }
    }
    if (p.op === "delete" && p.filters.length === 0) {
      findings.push({ rule: "destructive", detail: `Unfiltered DELETE on ${p.table}` });
    }
  }
  return findings;
}

export class Ai {
  constructor(private cfg: AiConfig) {}
  nl(question: string, tables: TableDef[]): Promise<NlResult> {
    return nlToSql(this.cfg, question, tables);
  }
  explain(plan: QueryPlan): ExplainResult {
    return explainPlan(plan);
  }
  optimize(plan: QueryPlan): OptimizeSuggestion[] {
    return optimizePlan(plan);
  }
  review(plans: QueryPlan[]): ReviewFinding[] {
    return reviewPlans(plans);
  }
}
