# @mountsqli/cache

MountSQLI intelligent multi-level caching subsystem — L1 memory cache, L2 distributed cache, automatic query cache, tag-based invalidation, and AI-driven optimization.

**Zero-config by default** — every `mountsqli` process gets an L1 memory cache automatically (LRU eviction, TTL, namespaces, tags). Add a Redis driver for L2 and the cache manager cascades reads: L1 → L2 → DB.

## Install

```bash
pnpm add @mountsqli/cache
```

For the Redis driver you also need `ioredis`:

```bash
pnpm add ioredis
```

## Quick start

```ts
import { createCache } from "@mountsqli/cache";

const cache = createCache();

// Resolve a value with cache-aside
const data = await cache.resolvePlan(plan, () => execute(query), { cache: true });

// Automatically invalidate after writes
await cache.invalidateAfterWrite(insertPlan);
```

## Architecture

```
Application
    ↓
CacheBridge       ← ORM integration point
    ↓
CacheManager      ← orchestrator (L1→L2 cascade)
    ↓
L1  MemoryCache   ← LRU/LFU/FIFO, TTL, tags, namespaces
L2  RedisCache     ← optional, Redis/Valkey/Dragonfly/KeyDB
```

## L1 Memory Cache

Built-in, zero-dep, <1ms hot latency:

| Feature | Support |
| --- | --- |
| Eviction | LRU, LFU, FIFO, TTL-only |
| Memory limit | Configurable (default 256 MB) |
| TTL | Per-key or global default |
| Sliding TTL | Resets on access |
| Tags | Group invalidation |
| Namespaces | Scoped clear/get/set |
| Compression | Pluggable |
| Cleanup | Periodic timer (unref'd) |
| Metrics | Hits, misses, evictions, memory |

```ts
import { MemoryCache } from "@mountsqli/cache";

const cache = new MemoryCache({ maxSize: 10000, strategy: "lru", defaultTtl: 300 });
await cache.set("key", value, { tags: ["users"], ttl: 60 });
await cache.get("key");
await cache.invalidateTag("users"); // bulk invalidate all tagged entries
```

## L2 Redis Driver

For distributed deployments. Compatible with Redis, Valkey, DragonflyDB, KeyDB, Upstash, Vercel KV.

```ts
import { RedisCacheDriver } from "@mountsqli/cache";

const l2 = new RedisCacheDriver({ url: "redis://localhost:6379" });

const manager = new CacheManager({ distributed: l2 });
await manager.get("key"); // L1 → L2 → miss
```

Features: cluster support, pub/sub cross-process invalidation, connection retry, key prefix namespacing, `scan`-based clear.

## Query Cache

The `QueryCacheAnalyzer` automatically determines if a query is cacheable:

- **Cacheable**: SELECT, COUNT, GROUP BY, aggregates, read-only WITH
- **Not cacheable**: NOW(), RANDOM(), UUID, CURRENT_TIMESTAMP, temp tables, INSERT/UPDATE/DELETE

```ts
import { QueryCacheAnalyzer } from "@mountsqli/cache";
const analyzer = new QueryCacheAnalyzer();
const result = analyzer.analyzeSql("SELECT * FROM users WHERE active = 1");
// { cacheable: true, cacheKey: "q:abc123", tables: ["users"] }
```

## Cache Warming

```ts
import { CacheWarmer } from "@mountsqli/cache";

const warmer = new CacheWarmer(manager);
warmer.start({
  name: "dashboard-stats",
  fetch: () => computeDashboardStats(),
  cacheKey: "dash:stats",
  ttl: 120,
  intervalMs: 60000,
});
```

## Background Refresh (stale-while-revalidate)

```ts
import { BackgroundRefresher } from "@mountsqli/cache";

const refresher = new BackgroundRefresher({ maxConcurrent: 5 });
const { value, fromCache, stale } = await refresher.resolve(
  "key",
  () => fetchFresh(),
  () => getCached(),
  { refreshTtlMs: 30000, staleTtlMs: 120000 },
);
// Returns stale data immediately while refreshing in background
```

## CLI

The cache commands are exposed through the `mountsqli` CLI:

```bash
npx mountsqli cache stats       # hit rate, entries, memory, top keys
npx mountsqli cache clear        # flush all cache
npx mountsqli cache inspect <key>  # show one entry's metadata + value
npx mountsqli cache analyze      # performance recommendations
npx mountsqli cache benchmark    # run throughput benchmarks
```

## Studio Dashboard

The cache dashboard is available in the Studio SPA at the ⚡ Cache tab:

- L1 and L2 live metrics (entries, hit rate, memory)
- Top cached keys by hit count
- Clear cache button

## Public API

| Export | Kind | Purpose |
| --- | --- | --- |
| `createCache()` | fn | Zero-config bridge (L1 only) |
| `CacheManager` | class | Multi-level orchestrator |
| `CacheBridge` | class | ORM integration (resolve + invalidate) |
| `MemoryCache` | class | L1 driver (LRU/LFU/FIFO) |
| `RedisCacheDriver` | class | L2 driver (Redis/Valkey/Dragonfly) |
| `CacheWarmer` | class | Periodic cache warming |
| `BackgroundRefresher` | class | Stale-while-revalidate |
| `QueryCacheAnalyzer` | class | Cacheability detection |

## Tests

```bash
pnpm --filter @mountsqli/cache test   # 25 tests — L1, manager, bridge, analyzer
```
