# @mountsqli/auth

Authentication, sessions, RBAC, and a row-level-security (RLS) policy engine for MountSQLI.

## Install

```bash
pnpm add @mountsqli/auth
```

## Passwords & JWT

```ts
import { hashPassword, verifyPassword, signJwt, verifyJwt } from "@mountsqli/auth";

const hash = await hashPassword("s3cret");      // scrypt, cost N=2^15 (stored in hash)
const ok = await verifyPassword(hash, "s3cret");

const token = await signJwt({ sub: "u1" }, secret, { alg: "HS256" });
const claims = await verifyJwt(token, secret);
// EdDSA keys also supported via generateEddsaKeys()
```

> **Security:** `verifyJwt` enforces the configured `alg` and rejects any token whose header `alg` differs (`bad-algorithm`) — closing the JWT algorithm-confusion attack. `hashPassword` uses scrypt `N = 2^15` with the cost factor persisted in the hash format `scrypt$<cost>$<salt>$<hash>` so it can be raised later without rehash. Password comparison is constant-time.

## Brute-force protection (opt-in)

Pass `rateLimit` to `AuthConfig` (facade) or `MountAuth` (framework). Failed logins per key (username/IP) lock out after `maxAttempts` within `windowSec`, for `lockoutSec`. Use `MemoryRateLimiter` directly for a hand-rolled login route.

```ts
import { Auth, MemoryRateLimiter } from "@mountsqli/auth";

const auth = new Auth({ jwtKey: "secret", rateLimit: { windowSec: 60, maxAttempts: 5, lockoutSec: 300 } });
// facade: auth.isLockedOut(key) / recordLoginFailure(key) / clearLoginFailures(key)
// framework: MountAuth.signIn() applies the limiter automatically
```

> `MemoryRateLimiter` is single-process. For multi-instance deploys, back it with a shared store (Redis) — the `RateLimiter` interface is `{ isLocked, recordFailure, reset }`.

## RBAC

Roles and permissions are plain data:

```ts
import { Rbac } from "@mountsqli/auth";

const rbac = new Rbac()
  .grant("admin", ["users:read", "users:write"])
  .grant("user",  ["users:read"]);

rbac.can("admin", "users:write"); // true
```

## RLS policy DSL → QueryPlan pushdown

Policies are **compiled into the QueryPlan** as `FilterNode[]` and injected as WHERE clauses — never row-filtered in app code. This keeps RLS in the plan so `@mountsqli/query` stays free of `@mountsqli/auth` and `core` stays light.

```ts
import { allowOwner, allowTenant, andPolicies, applyPolicy } from "@mountsqli/auth";

const policy = andPolicies(allowOwner("owner"), allowTenant("tenant"));

// In a request handler:
const builder = tableQuery(driver, files).withFilters(
  applyPolicy(policy, { userId: "u1", claims: { tenantId: "t9" } })
);
```

`applyPolicy` returns `FilterNode[]` (or a `WHERE 1=0` deny) for the builder to inject. `compilePolicy(policy, ctx)` returns `{ filters, deny }` directly — storage reuses the same engine (see `@mountsqli/storage`).

## OAuth (NextAuth-style)

`MountAuth` (`createAuth`) drives the authorization-code flow with **CSRF + PKCE** built in — no more login-CSRF:

```ts
const auth = createAuth({ jwt: { secret }, providers: [GoogleProvider({ clientId, clientSecret })] });

// Step 1 (in your /auth/[provider]/redirect route): sets a `mountsqli.csrf-token`
// + `mountsqli.pkce-verifier` HttpOnly cookie, returns the provider URL.
const url = await auth.getAuthorizationUrl("google", res);
// Step 2 (in your /auth/[provider]/callback route): VERIFIES the callback
// `state` matches the cookie (and supplies the PKCE verifier). Returns null on mismatch.
const result = await auth.handleCallback("google", code, state, req.headers, res);
// → { user, token } | null
```

`state` is generated and bound to the session cookie; PKCE `code_verifier`/`code_challenge` are wired for providers that support it (`GoogleProvider`, `GitHubProvider`). A callback with a mismatched/ missing `state` is rejected.

## API

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `hashPassword` / `verifyPassword` | fn | scrypt-based credentials. |
| `signJwt` / `verifyJwt` / `generateEddsaKeys` | fn | HS256 + EdDSA tokens. |
| `Rbac`, `Role`, `Permission` | class/type | Role → permission grants + `can()`. |
| `Auth`, `SessionRecord`, `MemoryTokenStore` | type/class | Session store + auth helper (opt-in `rateLimit`). |
| `MemoryRateLimiter`, `RateLimiter`, `RateLimitConfig` | class/type | Opt-in brute-force limiter for the login path. Inject a shared `RateLimiter` (e.g. Redis) via `AuthConfig.rateLimiter` for multi-instance. |
| `allowOwner` / `allowTenant` / `allowPublic` / `allowRole` / `andPolicies` | fn | Policy DSL builders. |
| `Policy`, `PolicyRule`, `PolicyContext` | type | Policy shape consumed by the compiler. |
| `compilePolicy(policy, ctx)` | fn | → `{ filters: FilterNode[]; deny: boolean }`. |
| `applyPolicy(policy, ctx)` | fn | Compile + inject into a builder. |
