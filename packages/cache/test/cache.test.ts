import { describe, it, expect } from "vitest";
import { MemoryCache } from "../src/memory.js";
import { CacheManager } from "../src/manager.js";
import { CacheBridge, createCache } from "../src/index.js";
import { QueryCacheAnalyzer, buildCacheKey } from "../src/query.js";

// ---------------------------------------------------------------------------
// Memory cache tests
// ---------------------------------------------------------------------------

describe("MemoryCache (L1)", () => {
  it("stores and retrieves values", async () => {
    const c = new MemoryCache();
    await c.set("a", 1);
    expect((await c.get("a"))?.value).toBe(1);
  });

  it("returns undefined for missing keys", async () => {
    const c = new MemoryCache();
    expect(await c.get("missing")).toBeUndefined();
  });

  it("respects TTL expiration", async () => {
    const c = new MemoryCache({ defaultTtl: 0.01 }); // 10ms
    await c.set("a", 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await c.get("a")).toBeUndefined();
  });

  it("resets TTL on access with sliding TTL", async () => {
    const c = new MemoryCache({ slidingTtl: 1 });
    await c.set("a", 1, { ttl: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect((await c.get("a"))?.value).toBe(1); // resets
  });

  it("deletes keys", async () => {
    const c = new MemoryCache();
    await c.set("a", 1);
    await c.delete("a");
    expect(await c.get("a")).toBeUndefined();
  });

  it("clears all entries", async () => {
    const c = new MemoryCache();
    await c.set("a", 1);
    await c.set("b", 2);
    await c.clear();
    expect(await c.size()).toBe(0);
  });

  it("supports namespace-scoped clear", async () => {
    const c = new MemoryCache();
    await c.set("a", 1, { namespace: "ns1" });
    await c.set("b", 2, { namespace: "ns2" });
    await c.clear("ns1");
    expect(await c.get("a")).toBeUndefined();
    expect((await c.get("b"))?.value).toBe(2);
  });

  it("evicts LRU when at capacity", async () => {
    const c = new MemoryCache({ maxSize: 3, strategy: "lru" });
    await c.set("a", 1);
    await c.set("b", 2);
    await c.set("c", 3);
    await c.get("a"); // make "a" recently used
    await c.set("d", 4); // should evict "b" (least recently used)
    expect(await c.get("a")).toBeDefined();
    expect(await c.get("b")).toBeUndefined();
  });

  it("tracks hits and misses", async () => {
    const c = new MemoryCache();
    await c.set("a", 1);
    await c.get("a");
    await c.get("missing");
    const s = await c.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBe(0.5);
  });

  it("supports increment", async () => {
    const c = new MemoryCache();
    expect(await c.increment("counter")).toBe(1);
    expect(await c.increment("counter", 5)).toBe(6);
  });

  it("tags: invalidation by tag", async () => {
    const c = new MemoryCache();
    await c.set("u1", { id: 1 }, { tags: ["users"] });
    await c.set("u2", { id: 2 }, { tags: ["users"] });
    await c.set("p1", { id: 1 }, { tags: ["posts"] });
    expect(await c.size()).toBe(3);
    const n = await c.invalidateTag("users");
    expect(n).toBe(2);
    expect(await c.get("u1")).toBeUndefined();
    expect(await c.get("u2")).toBeUndefined();
    expect((await c.get("p1"))?.value).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cache Manager tests
// ---------------------------------------------------------------------------

describe("CacheManager", () => {
  it("routes through L1 by default", async () => {
    const m = new CacheManager();
    await m.set("a", 1);
    expect(await m.get("a")).toBe(1);
  });

  it("L1+L2: reads populate L1 from L2", async () => {
    const l2 = new MemoryCache();
    const m = new CacheManager({ distributed: l2 as any });
    await l2.set("a", 99);
    const val = await m.get("a");
    expect(val).toBe(99);
    // L1 now has it
    const l1Val = await m.l1.get("a");
    expect(l1Val?.value).toBe(99);
  });

  it("resolve: cache miss fetches and populates", async () => {
    const m = new CacheManager();
    let calls = 0;
    const val = await m.resolve("key", async () => {
      calls++;
      return 42;
    });
    expect(val).toBe(42);
    expect(calls).toBe(1);
    // Second call hits cache
    const val2 = await m.resolve("key", async () => {
      calls++;
      return 99;
    });
    expect(val2).toBe(42); // cached version
    expect(calls).toBe(1);
  });

  it("resolve: bypass skips cache", async () => {
    const m = new CacheManager();
    let calls = 0;
    await m.resolve("k", async () => { calls++; return 1; });
    await m.resolve("k", async () => { calls++; return 2; }, { bypass: true });
    expect(calls).toBe(2);
  });

  it("invalidateTag clears all entries with that tag", async () => {
    const m = new CacheManager();
    await m.set("a", 1, { tags: ["x"] });
    await m.set("b", 2, { tags: ["x"] });
    expect(await m.get("a")).toBe(1);
    await m.invalidateTag("x");
    expect(await m.get("a")).toBeUndefined();
    expect(await m.get("b")).toBeUndefined();
  });

  it("provides stats", async () => {
    const m = new CacheManager();
    await m.set("a", 1);
    await m.get("a");
    await m.get("missing");
    const s = await m.stats();
    expect(s.l1?.hits).toBe(1);
    expect(s.l1?.misses).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CacheBridge tests
// ---------------------------------------------------------------------------

describe("CacheBridge", () => {
  it("resolvePlan caches on cacheable select", async () => {
    const bridge = new CacheBridge();
    let calls = 0;
    const plan = { op: "select", table: "users", columns: ["id"], filters: [], columnTypes: {} } as any;
    const r1 = await bridge.resolvePlan(plan, async () => {
      calls++;
      return { rows: [{ id: 1 }] };
    }, { cache: true });
    expect(calls).toBe(1);
    expect(r1.fromCache).toBe(false);
    expect(r1.rows).toEqual([{ id: 1 }]);

    const r2 = await bridge.resolvePlan(plan, async () => {
      calls++;
      return { rows: [{ id: 2 }] };
    }, { cache: true });
    expect(calls).toBe(1); // no additional call
    expect(r2.fromCache).toBe(true);
    expect(r2.rows).toEqual([{ id: 1 }]); // cached version
  });

  it("resolvePlan bypasses cache on write operations", async () => {
    const bridge = new CacheBridge();
    let calls = 0;
    const plan = { op: "insert", table: "users", values: { id: 1 }, filters: [], columnTypes: {} } as any;
    await bridge.resolvePlan(plan, async () => {
      calls++;
      return { rows: [] };
    });
    expect(calls).toBe(1);
    // Mutating ops should never cache
    await bridge.resolvePlan(plan, async () => {
      calls++;
      return { rows: [] };
    });
    expect(calls).toBe(2);
  });

  it("invalidateAfterWrite clears related tags", async () => {
    const bridge = new CacheBridge();
    await bridge.manager.set("q:abc", [1, 2, 3], { tags: ["users"] });
    expect(await bridge.manager.get("q:abc")).toBeDefined();
    await bridge.invalidateAfterWrite({ op: "update", table: "users", filters: [], columnTypes: {} } as any);
    expect(await bridge.manager.get("q:abc")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Query analyzer tests
// ---------------------------------------------------------------------------

describe("QueryCacheAnalyzer", () => {
  it("marks select as cacheable", () => {
    const a = new QueryCacheAnalyzer();
    expect(a.analyze({ op: "select", table: "users", columns: ["id"], filters: [], columnTypes: {} } as any).cacheable).toBe(true);
  });

  it("marks insert/update/delete as non-cacheable", () => {
    const a = new QueryCacheAnalyzer();
    expect(a.analyze({ op: "insert", table: "u", filters: [], columnTypes: {} } as any).cacheable).toBe(false);
    expect(a.analyze({ op: "update", table: "u", filters: [], columnTypes: {} } as any).cacheable).toBe(false);
    expect(a.analyze({ op: "delete", table: "u", filters: [], columnTypes: {} } as any).cacheable).toBe(false);
  });

  it("analyzes raw SQL for cacheability", () => {
    const a = new QueryCacheAnalyzer();
    expect(a.analyzeSql("SELECT * FROM users").cacheable).toBe(true);
    expect(a.analyzeSql("SELECT NOW()").cacheable).toBe(false);
    expect(a.analyzeSql("SELECT RAND()").cacheable).toBe(false);
    expect(a.analyzeSql("INSERT INTO users").cacheable).toBe(false);
  });

  it("buildCacheKey produces deterministic hashes", () => {
    const k1 = buildCacheKey("SELECT * FROM users WHERE id = ?", [1]);
    const k2 = buildCacheKey("SELECT * FROM users WHERE id = ?", [1]);
    expect(k1).toBe(k2);
    const k3 = buildCacheKey("SELECT * FROM users WHERE id = ?", [2]);
    expect(k1).not.toBe(k3);
  });
});

describe("createCache", () => {
  it("returns a working CacheBridge", () => {
    const c = createCache();
    expect(c).toBeInstanceOf(CacheBridge);
    expect(c.manager).toBeDefined();
    expect(c.analyzer).toBeDefined();
  });
});
