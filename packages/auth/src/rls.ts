// MountSQLI — RLS composition over the query builder.
//
// `applyPolicy` compiles an auth Policy against a request context and pushes
// the resulting FilterNode[] DOWN into the QueryPlan. This is the mechanism
// that makes row-level security enforced at the SQL layer (plan.md §10),
// not by filtering rows in application code. The builder stays immutable.

import type { QueryBuilder } from "@mountsqli/query";
import { compilePolicy, type Policy, type PolicyContext } from "./policy.js";

/**
 * Apply an RLS policy to a query builder. Returns a new builder with the
 * policy's WHERE predicates injected. If the policy resolves to an explicit
 * deny, the builder is forced to match nothing (WHERE 1=0).
 */
export function applyPolicy(
  builder: QueryBuilder<any>,
  policy: Policy,
  ctx: PolicyContext,
): QueryBuilder<any> {
  return applyPolicies(builder, [policy], ctx);
}

/** Convenience: apply multiple policies (all must pass). */
export function applyPolicies(builder: QueryBuilder<any>, policies: Policy[], ctx: PolicyContext): QueryBuilder<any> {
  let b = builder;
  for (const p of policies) {
    const { filters, deny } = compilePolicy(p, ctx);
    b = deny ? b.deny() : b.withFilters(filters);
  }
  // Mark the plan as RLS-applied so an `enforceRls` Db won't reject it (issue 003).
  return b.withRlsApplied();
}
