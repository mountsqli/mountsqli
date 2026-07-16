/**
 * MountSQLI Auth — Main entry point.
 *
 * Provides two layers:
 *  - NextAuth.js-style framework (`MountAuth`, `createAuth`, providers, adapter).
 *  - Lower-level primitives used by the example apps and the test suite
 *    (crypto, RBAC, RLS policy DSL, session/token stores).
 */

// NextAuth.js-style framework
export { MountAuth, createAuth } from "./core/auth.js";
export { createPgAdapter } from "./adapters/pg.js";
export {
  GoogleProvider,
  GitHubProvider,
  DiscordProvider,
  TwitterProvider,
  CredentialsProvider,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from "./providers/index.js";

// Crypto primitives
export {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  generateEddsaKeys,
} from "./crypto.js";

// RBAC + RLS policy DSL
export { Rbac } from "./rbac.js";
export { MemoryRateLimiter, type RateLimiter, type RateLimitConfig } from "./rate-limit.js";
export {
  applyPolicy,
  applyPolicies,
} from "./rls.js";
export {
  allowOwner,
  allowTenant,
  allowPublic,
  allowRole,
  andPolicies,
  compilePolicy,
} from "./policy.js";

// Session + token stores (legacy facade)
export {
  Auth,
  MemoryTokenStore,
  SqliteTokenStore,
  PgTokenStore,
} from "./session.js";

// Types
export type {
  Provider,
  User,
  Session,
  Account,
  Adapter,
  Callbacks,
  Events,
  AuthConfig,
  CookieOptions,
  JWTPayload,
  OAuthConfig,
  CredentialsConfig,
} from "./types/index.js";

// Policy / RLS types
export type {
  Policy,
  PolicyContext,
  PolicyRule,
} from "./policy.js";

// RLS policy registry (issue 003) — register per-table default policies and
// enforce their application at query time via `enforceRls` in mount config.
export { createPolicyRegistry } from "./policy-registry.js";
export type { PolicyRegistry } from "./policy-registry.js";
