/**
 * Minimal RLS policy DSL — compiled to FilterNode[] for storage ACL checks.
 * FilterNode is imported from @mountsqli/compiler to keep the type in sync
 * with storage and query packages.
 */

import type { FilterNode } from '@mountsqli/compiler';

export interface PolicyContext {
  userId?: string | number;
  roles?: string[];
  claims?: Record<string, unknown>;
}

export type Policy = (ctx: PolicyContext) => { deny: boolean; filters: FilterNode[] };

export function compilePolicy(policy: Policy, ctx: PolicyContext): { deny: boolean; filters: FilterNode[] } {
  return policy(ctx);
}
