// MountSQLI — RLS Policy DSL.
//
// The core idea from plan.md §10: auth policies are COMPILED INTO the
// QueryPlan as FilterNode[], so row-level security is enforced at the SQL
// layer (injected WHERE clauses) — never by filtering rows in app code.
//
// A Policy is a pure function from a request context to a list of policy
// rules. Each rule compiles to one or more FilterNode (or a sub-clause).
// Because policies return plain data, they are serializable, testable, and
// auditable — and the optimizer can reason about them.

import type { Comparator, FilterNode } from "@mountsqli/compiler";

/** A single RLS expression that resolves to zero or more filter nodes. */
export type PolicyRule =
  | { column: string; op: Comparator; value: unknown }
  | { column: string; op: "in"; value: unknown[] }
  // tenant/owner isolation: column must equal a value pulled from ctx
  | { column: string; equalsContext: string }
  // logical AND of sub-rules
  | { all: PolicyRule[] }
  // logical OR of sub-rules (e.g. "owner OR public")
  | { any: PolicyRule[] }
  // explicit deny (short-circuits the whole query to return nothing)
  | { deny: true };

export interface PolicyContext {
  /** Authenticated subject, or null for anonymous. */
  userId?: string | number;
  roles?: string[];
  /** Arbitrary claims (tenant id, scopes, etc.). */
  claims?: Record<string, unknown>;
}

export type Policy = (ctx: PolicyContext) => PolicyRule[];

// ---- policy builders (ergonomic DSL) ----

export const allowOwner = (column = "user_id"): Policy => (ctx) =>
  ctx.userId == null ? [{ deny: true }] : [{ column, equalsContext: "userId" }];

export const allowTenant = (column = "tenant_id"): Policy => (ctx) =>
  ctx.claims?.tenantId == null ? [{ deny: true }] : [{ column, equalsContext: "claims.tenantId" }];

export const allowPublic: Policy = () => []; // no restriction

export const allowRole = (...roles: string[]): Policy => (ctx) =>
  ctx.roles && roles.some((r) => ctx.roles!.includes(r)) ? [] : [{ deny: true }];

/** Combine multiple policies: a row is visible if it passes ALL policies. */
export function andPolicies(...policies: Policy[]): Policy {
  return (ctx) => policies.flatMap((p) => p(ctx));
}

// ---- compilation: PolicyRule[] -> FilterNode[] ----

export interface CompileOptions {
  /** Resolve an `equalsContext` key against the context. */
  ctx: PolicyContext;
}

/**
 * Compile a policy's rules into FilterNode[] for injection into a QueryPlan.
 * Returns `{ deny: true }` if any rule is an explicit deny.
 */
/** Resolve an `equalsContext` key against the context, supporting dotted
 * paths like "claims.tenantId" (falls back to a top-level key). */
function resolveContext(ctx: PolicyContext, key: string): unknown {
  if (key.includes(".")) {
    const [head, ...rest] = key.split(".");
    const base = (ctx as any)[head!];
    return base != null ? base[rest.join(".")] : undefined;
  }
  if ((ctx as any)[key] != null) return (ctx as any)[key];
  return (ctx as any).claims?.[key];
}

export function compilePolicy(policy: Policy, ctx: PolicyContext): { filters: FilterNode[]; deny: boolean } {
  const rules = policy(ctx);
  const filters: FilterNode[] = [];
  for (const rule of rules) {
    if ("deny" in rule && rule.deny) return { filters: [], deny: true };
    if ("equalsContext" in rule) {
      const v = resolveContext(ctx, rule.equalsContext);
      if (v == null) return { filters: [], deny: true };
      filters.push({ kind: "filter", column: rule.column, op: "=", value: v });
    } else if ("all" in rule) {
      for (const sub of rule.all) {
        const c = singleRuleToFilter(sub, ctx);
        if (c.deny) return { filters: [], deny: true };
        filters.push(...c.filters);
      }
    } else if ("any" in rule) {
      // Compile OR rules into a single `{ kind: "or" }` FilterNode for the
      // compiler to expand into SQL `(cond1 OR cond2 OR ...)`.
      const subs = rule.any.map((sub) => singleRuleToFilter(sub, ctx));
      if (subs.some((s) => !s.deny && s.filters.length === 0)) continue; // public branch wins
      if (subs.some((s) => s.deny)) return { filters: [], deny: true };
      const orFilters = subs.flatMap((s) => s.filters);
      if (orFilters.length > 0) filters.push({ kind: "or", filters: orFilters });
    } else {
      const eq = rule as Extract<PolicyRule, { op: Comparator }>;
      filters.push({ kind: "filter", column: eq.column, op: eq.op, value: eq.value });
    }
  }
  return { filters, deny: false };
}

// Extract the simple equality/IN rule (the only PolicyRule variant left
// after deny/equalsContext/all/any have been handled).
function asSimple(rule: PolicyRule): { column: string; op: Comparator; value: unknown } {
  return rule as { column: string; op: Comparator; value: unknown };
}

function singleRuleToFilter(rule: PolicyRule, ctx: PolicyContext): { filters: FilterNode[]; deny: boolean } {
  if ("deny" in rule && rule.deny) return { filters: [], deny: true };
  if ("equalsContext" in rule) {
    const v = resolveContext(ctx, rule.equalsContext);
    if (v == null) return { filters: [], deny: true };
    return { filters: [{ kind: "filter", column: rule.column, op: "=", value: v }], deny: false };
  }
  if ("all" in rule) {
    const out: FilterNode[] = [];
    for (const sub of rule.all) {
      const c = singleRuleToFilter(sub, ctx);
      if (c.deny) return { filters: [], deny: true };
      out.push(...c.filters);
    }
    return { filters: out, deny: false };
  }
  if ("any" in rule) {
    const subs = rule.any.map((sub) => singleRuleToFilter(sub, ctx));
    if (subs.some((s) => !s.deny && s.filters.length === 0)) return { filters: [], deny: false };
    if (subs.some((s) => s.deny)) return { filters: [], deny: true };
    const orFilters = subs.flatMap((s) => s.filters);
    if (orFilters.length === 0) return { filters: [], deny: false };
    return { filters: [{ kind: "or", filters: orFilters }], deny: false };
  }
  const eq = asSimple(rule);
  return { filters: [{ kind: "filter", column: eq.column, op: eq.op, value: eq.value }], deny: false };
}
