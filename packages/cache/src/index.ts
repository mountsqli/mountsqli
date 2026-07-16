// MountSQLI — intelligent multi-level caching subsystem.
//
// Public exports: everything a consumer (ORM, CLI, Studio, plugins) needs.

// ---- Core cache manager ----
export { CacheManager } from "./manager.js";
export { CacheBridge } from "./bridge.js";
export { MemoryCache } from "./memory.js";
export { QueryCacheAnalyzer, buildCacheKey } from "./query.js";
export { RedisCacheDriver } from "./redis.js";
export { CacheWarmer, BackgroundRefresher } from "./warming.js";

// ---- Types ----
export type { WithCacheResult } from "./bridge.js";
export type { RedisCacheOptions } from "./redis.js";
export type { WarmingJob, RefreshEntry } from "./warming.js";

export type {
  CacheDriver,
  CacheEntryMeta,
  CacheSetOptions,
  CacheDriverStats,
  CacheManagerConfig,
  CacheQueryOptions,
  CacheStats,
  CacheStatsEntry,
  CachePolicy,
  CacheLock,
  CachePlugin,
  QueryCacheability,
  EvictionStrategy,
  MemoryCacheConfig,
  QueryCacheConfig,
  AiCacheConfig,
  CompressionConfig,
  BackgroundRefreshConfig,
  WarmingConfig,
  InvalidationEvent,
} from "./types.js";

import { CacheBridge } from "./bridge.js";

/**
 * Create a cache bridge with sensible defaults. Zero-config.
 *
 * ```ts
 * import { createCache } from "@mountsqli/cache";
 * const cache = createCache();
 * await cache.resolvePlan(plan, () => driver.query(...));
 * await cache.invalidateAfterWrite(plan);
 * ```
 */
export function createCache(): CacheBridge {
  return new CacheBridge();
}
