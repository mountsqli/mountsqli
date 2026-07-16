// MountSQLI — RLS policy registry (issue 003).
//
// Tables can register a *default* RLS policy alongside the app's auth config.
// When a `Db` is created with `enforceRls: true`, executing a query against a
// table that has a registered policy — without first calling `applyPolicy(...)`
// (or `.unsafe()`) — throws a `MountError("FORBIDDEN")`, turning "forgot the
// policy" from a silent data leak into a hard runtime error.

import type { Policy } from "./policy.js";

export interface PolicyRegistry {
  register(table: string, policy: Policy): void;
  get(table: string): Policy | undefined;
  has(table: string): boolean;
}

export function createPolicyRegistry(): PolicyRegistry {
  const map = new Map<string, Policy>();
  return {
    register(table, policy) {
      map.set(table, policy);
    },
    get(table) {
      return map.get(table);
    },
    has(table) {
      return map.has(table);
    },
  };
}
