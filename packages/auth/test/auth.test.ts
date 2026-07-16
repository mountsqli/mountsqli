import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt,
  generateEddsaKeys,
  Rbac,
  allowOwner,
  allowTenant,
  allowRole,
  andPolicies,
  compilePolicy,
  applyPolicy,
  Auth,
  MemoryTokenStore,
  MemoryRateLimiter,
  createPolicyRegistry,
  MountAuth,
} from "@mountsqli/auth";
import { defineTable, int, text } from "@mountsqli/schema";
import { MockDriver } from "@mountsqli/driver";
import { tableQuery } from "@mountsqli/query";
import { compilePlan } from "@mountsqli/compiler";

const posts = defineTable("posts", {
  id: int().pk(),
  title: text().notNull(),
  user_id: int().notNull(),
  tenant_id: int().notNull(),
});

describe("auth crypto", () => {
  it("hashes and verifies a password (scrypt, constant-time)", () => {
    const h = hashPassword("s3cret");
    expect(h).not.toContain("s3cret");
    expect(verifyPassword("s3cret", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("signs and verifies an HS256 JWT with expiry", () => {
    const token = signJwt({ sub: "42", role: "admin" }, { key: "topsecret", expiresInSec: 60, issuer: "mount" });
    const v = verifyJwt(token, { key: "topsecret", issuer: "mount" });
    expect(v.ok).toBe(true);
    expect(v.payload?.sub).toBe("42");
  });

  it("rejects an expired HS256 JWT", () => {
    const token = signJwt({ sub: "42" }, { key: "topsecret", expiresInSec: -1 });
    const v = verifyJwt(token, { key: "topsecret" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("expired");
  });

  it("signs and verifies an EdDSA (Ed25519) JWT", () => {
    const { privateKey, publicKey } = generateEddsaKeys();
    const token = signJwt({ sub: "7" }, { key: privateKey, alg: "EdDSA", expiresInSec: 60 });
    const v = verifyJwt(token, { key: publicKey, alg: "EdDSA" });
    expect(v.ok).toBe(true);
  });

  it("rejects a JWT signed with the wrong key", () => {
    const token = signJwt({ sub: "1" }, { key: "a" });
    expect(verifyJwt(token, { key: "b" }).ok).toBe(false);
  });

  it("rejects algorithm confusion (EdDSA token against HS256 key)", () => {
    // Attacker forges an EdDSA-signed token but the server verifies HS256.
    const { privateKey } = generateEddsaKeys();
    const forged = signJwt({ sub: "attacker" }, { key: privateKey, alg: "EdDSA" });
    // Server is configured for HS256 with a shared secret — must NOT accept it.
    const v = verifyJwt(forged, { key: "hS256-secret", alg: "HS256" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("bad-algorithm");
  });

  it("rejects a token whose header alg mismatches the configured alg", () => {
    const token = signJwt({ sub: "1" }, { key: "secret" }); // HS256
    const v = verifyJwt(token, { key: "secret", alg: "EdDSA" });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("bad-algorithm");
  });
});

describe("RBAC", () => {
  it("computes effective permissions and supports wildcards", () => {
    const rbac = new Rbac()
      .define({ name: "reader", permissions: ["posts:read"] })
      .define({ name: "writer", permissions: ["posts:write", "posts:*"] });
    expect(rbac.can(["reader"], "posts:read")).toBe(true);
    expect(rbac.canWildcard(["reader"], "posts:write")).toBe(false);
    expect(rbac.canWildcard(["writer"], "posts:delete")).toBe(true); // posts:*
  });
});

describe("policy DSL -> FilterNode[]", () => {
  it("allowOwner injects a user_id = ctx.userId equality", () => {
    const { filters, deny } = compilePolicy(allowOwner("user_id"), { userId: 9 });
    expect(deny).toBe(false);
    expect(filters).toEqual([{ kind: "filter", column: "user_id", op: "=", value: 9 }]);
  });

  it("allowOwner denies when unauthenticated", () => {
    const { deny } = compilePolicy(allowOwner("user_id"), {});
    expect(deny).toBe(true);
  });

  it("allowTenant reads the tenant claim", () => {
    const { filters } = compilePolicy(allowTenant("tenant_id"), { claims: { tenantId: 5 } });
    expect(filters[0]).toEqual({ kind: "filter", column: "tenant_id", op: "=", value: 5 });
  });

  it("andPolicies combines owner + tenant", () => {
    const p = andPolicies(allowOwner("user_id"), allowTenant("tenant_id"));
    const { filters } = compilePolicy(p, { userId: 3, claims: { tenantId: 8 } });
    expect(filters).toHaveLength(2);
  });

  it("allowRole denies without the role", () => {
    expect(compilePolicy(allowRole("admin"), { roles: ["user"] }).deny).toBe(true);
    expect(compilePolicy(allowRole("admin"), { roles: ["admin"] }).deny).toBe(false);
  });
});

describe("RLS pushdown into the QueryPlan (SQL layer enforcement)", () => {
  const driver = new MockDriver();

  it("injects user_id = ? into the compiled SQL", () => {
    const base = tableQuery(driver, posts);
    const scoped = applyPolicy(base, allowOwner("user_id"), { userId: 9 });
    const sql = compilePlan(scoped._plan).sql;
    expect(sql).toBe('SELECT * FROM "posts" WHERE "user_id" = ?');
    expect(compilePlan(scoped._plan).params).toEqual([9]);
  });

  it("compiles an explicit deny to WHERE 1=0", () => {
    const base = tableQuery(driver, posts);
    const scoped = applyPolicy(base, allowOwner("user_id"), {}); // anonymous -> deny
    expect(compilePlan(scoped._plan).sql).toBe('SELECT * FROM "posts" WHERE 1=0');
  });

  it("chains with existing filters (AND)", () => {
    const base = tableQuery(driver, posts).where("title", "like", "hello%");
    const scoped = applyPolicy(base, allowTenant("tenant_id"), { claims: { tenantId: 4 } });
    const sql = compilePlan(scoped._plan).sql;
    expect(sql).toBe('SELECT * FROM "posts" WHERE "title" LIKE ? AND "tenant_id" = ?');
  });
});

describe("RLS enforcement mode (issue 003)", () => {
  // A driver in enforceRls mode with a registry that protects "posts".
  function enforcingDriver() {
    const driver = new MockDriver() as any;
    const registry = createPolicyRegistry();
    registry.register("posts", allowOwner("user_id"));
    driver.rls = { enforce: true, registry };
    return driver;
  }

  it("rejects an unguarded query against a protected table", async () => {
    const q = tableQuery(enforcingDriver(), posts);
    await expect(q.select()).rejects.toThrow(/RLS policy not applied/);
  });

  it("rejects .findOne() without a policy applied", async () => {
    const q = tableQuery(enforcingDriver(), posts);
    await expect(q.findOne()).rejects.toThrow(/RLS policy not applied/);
  });

  it("allows a query that applied the policy via applyPolicy", async () => {
    const driver = enforcingDriver();
    const q = applyPolicy(tableQuery(driver, posts), allowOwner("user_id"), { userId: 9 });
    // MockDriver returns [] by default; the point is no FORBIDDEN error is thrown.
    await expect(q.select()).resolves.toEqual([]);
  });

  it(".unsafe() opts out of enforcement", async () => {
    const driver = enforcingDriver();
    const q = tableQuery(driver, posts).unsafe();
    await expect(q.select()).resolves.toEqual([]);
  });

  it("does NOT enforce on tables without a registered policy", async () => {
    const driver = enforcingDriver();
    const comments = defineTable("comments", { id: int().pk(), body: text().notNull() });
    const q = tableQuery(driver, comments);
    await expect(q.select()).resolves.toEqual([]);
  });

  it("does NOT enforce when enforceRls is off", async () => {
    const driver = new MockDriver() as any;
    const registry = createPolicyRegistry();
    registry.register("posts", allowOwner("user_id"));
    driver.rls = { enforce: false, registry };
    const q = tableQuery(driver, posts);
    await expect(q.select()).resolves.toEqual([]);
  });
});

describe("Auth facade (sessions)", () => {
  it("logs in, authenticates, and logs out", async () => {
    const auth = new Auth({ jwtKey: "secret", store: new MemoryTokenStore() });
    const { token } = await auth.login({ userId: 1, roles: ["user"], claims: { tenantId: 2 } });
    const r = await auth.authenticate(token);
    expect(r.ok).toBe(true);
    expect(r.user?.userId).toBe("1");
    expect(r.user?.claims.tenantId).toBe(2);
    await auth.logout(token);
    expect((await auth.authenticate(token)).ok).toBe(false);
  });

  it("verifies passwords through the facade", () => {
    const auth = new Auth({ jwtKey: "x" });
    const h = auth.hashPassword("pw");
    expect(auth.verifyPassword("pw", h)).toBe(true);
  });

  it("rate-limits failed logins and locks out (issue audit #6)", () => {
    const auth = new Auth({
      jwtKey: "x",
      rateLimit: { windowSec: 60, maxAttempts: 3, lockoutSec: 300 },
    });
    const key = "attacker@x";
    // First 2 failures don't lock yet.
    auth.recordLoginFailure(key);
    auth.recordLoginFailure(key);
    expect(auth.isLockedOut(key)).toBe(false);
    // 3rd failure triggers the lockout.
    auth.recordLoginFailure(key);
    expect(auth.isLockedOut(key)).toBe(true);
    // A successful login clears the failures.
    auth.clearLoginFailures(key);
    expect(auth.isLockedOut(key)).toBe(false);
  });

  it("MemoryRateLimiter exports and enforces independently per key", () => {
    const lim = new MemoryRateLimiter({ windowSec: 60, maxAttempts: 2, lockoutSec: 300 });
    expect(lim.isLocked("a")).toBe(false);
    lim.recordFailure("a");
    lim.recordFailure("a");
    expect(lim.isLocked("a")).toBe(true);
    expect(lim.isLocked("b")).toBe(false); // independent key
    lim.reset("a");
    expect(lim.isLocked("a")).toBe(false);
  });
});

describe("OAuth CSRF + PKCE state binding (audit #4)", () => {
  // A fake oauth provider with deterministic behavior.
  function fakeProvider() {
    return {
      id: "fake",
      name: "Fake",
      type: "oauth" as const,
      version: "2.0",
      supportsPkce: true,
      authorizeUrl(state?: string, codeChallenge?: string): string {
        const p = new URLSearchParams({ state: state ?? "", ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}) });
        return `https://fake.test/auth?${p}`;
      },
      async exchangeCode(_code: string, _verifier?: string) {
        return { id: "u1", email: "a@b.c", name: "A", avatar: null };
      },
    };
  }

  // Minimal Response with a real Headers bag.
  function fakeRes() {
    const headers = new Headers();
    return { headers, cookies: [] as string[] };
  }

  it("getAuthorizationUrl sets a csrf cookie + PKCE verifier cookie", async () => {
    const auth = new MountAuth({ jwt: { secret: "test" }, providers: [fakeProvider() as any] });
    const res = fakeRes() as any;
    const url = await (auth as any).getAuthorizationUrl("fake", res);
    expect(url).toContain("state=");
    const setCookies = res.headers.get("set-cookie") ?? "";
    expect(setCookies).toContain("mountsqli.csrf-token="); // state cookie
    expect(setCookies).toContain("mountsqli.pkce-verifier="); // PKCE verifier cookie
  });

  it("handleCallback rejects a mismatched state (login-CSRF guard)", async () => {
    const auth = new MountAuth({ jwt: { secret: "test" }, providers: [fakeProvider() as any] });
    const res = fakeRes() as any;
    const headers = new Headers(); // no csrf cookie → mismatch
    const result = await (auth as any).handleCallback("fake", "code123", "attacker-state", headers, res);
    expect(result).toBeNull();
  });

  it("handleCallback succeeds when state matches the cookie", async () => {
    const auth = new MountAuth({ jwt: { secret: "test" }, providers: [fakeProvider() as any] });
    const res = fakeRes() as any;
    const url = await (auth as any).getAuthorizationUrl("fake", res);
    const state = new URL(url).searchParams.get("state")!;
    // Replay the csrf cookie the redirect set.
    const csrf = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
    const headers = new Headers({ cookie: csrf });
    const result = await (auth as any).handleCallback("fake", "code123", state, headers, res);
    expect(result).not.toBeNull();
    expect((result as any).user.id).toBe("u1");
  });
});
