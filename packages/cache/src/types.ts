// MountSQLI — Cache types, interfaces, and configuration.
//
// This file defines the complete type surface for the multi-level caching
// subsystem. Every cache layer, driver, and strategy is represented here so
// the rest of the engine can consume it without importing implementation details.

// ---------------------------------------------------------------------------
// Eviction strategies
// ---------------------------------------------------------------------------

export type EvictionStrategy = "lru" | "lfu" | "fifo" | "ttl-only";

// ---------------------------------------------------------------------------
// Cache entry metadata
// ---------------------------------------------------------------------------

export interface CacheEntryMeta<T = unknown> {
  /** Serialized value (stored as string for compression). */
  value: T;
  /** Expiration timestamp (ms epoch). 0 = no expiration. */
  expiresAt: number;
  /** Tags attached to this entry (for bulk invalidation). */
  tags: string[];
  /** Namespace this entry belongs to. */
  namespace: string;
  /** Created timestamp. */
  createdAt: number;
  /** Last access timestamp (LRU/LFU tracking). */
  lastAccessed: number;
  /** Access count (LFU tracking). */
  accessCount: number;
  /** Serialized size in bytes. */
  sizeBytes: number;
  /** Whether this entry is compressed. */
  compressed: boolean;
  /** Hit count for monitoring. */
  hits: number;
}

// ---------------------------------------------------------------------------
// Cache driver interface — implement this to create custom backends
// ---------------------------------------------------------------------------

export interface CacheDriver {
  readonly name: string;
  readonly ready: Promise<void>;

  /** Get a cached value. Returns undefined on miss. */
  get<T = unknown>(key: string): Promise<CacheEntryMeta<T> | undefined>;

  /** Set a cached value. */
  set<T = unknown>(key: string, value: T, opts?: CacheSetOptions): Promise<void>;

  /** Delete a single key. */
  delete(key: string): Promise<boolean>;

  /** Clear all entries in this namespace (or all if namespace is empty). */
  clear(namespace?: string): Promise<void>;

  /** Check if a key exists. */
  has(key: string): Promise<boolean>;

  /** Return approximate number of entries. */
  size(): Promise<number>;

  /** Return keys matching a pattern (glob-style). */
  keys(pattern?: string): Promise<string[]>;

  /** Increment a key (for counters). */
  increment(key: string, by?: number): Promise<number>;

  /** Close the driver (release connections). */
  close(): Promise<void>;

  /** Get driver-level metrics. */
  stats(): Promise<CacheDriverStats>;
}

export interface CacheSetOptions {
  /** Time-to-live in seconds. */
  ttl?: number;
  /** Tags for group invalidation. */
  tags?: string[];
  /** Namespace (defaults to "default"). */
  namespace?: string;
  /** Skip compression for this value. */
  noCompress?: boolean;
}

// ---------------------------------------------------------------------------
// Driver statistics
// ---------------------------------------------------------------------------

export interface CacheDriverStats {
  entries: number;
  memoryBytes?: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

// ---------------------------------------------------------------------------
// Cache manager interface — the multi-level orchestrator
// ---------------------------------------------------------------------------

export interface CacheManagerConfig {
  /** Default TTL in seconds (global fallback). */
  defaultTtl?: number;
  /** Enable the L1 memory cache. */
  memory?: boolean | MemoryCacheConfig;
  /** L2 distributed cache driver. */
  distributed?: CacheDriver;
  /** Enable query result caching. */
  queryCache?: boolean | QueryCacheConfig;
  /** Enable metadata caching. */
  metadataCache?: boolean;
  /** Enable auth/permission caching. */
  authCache?: boolean;
  /** Enable AI caching. */
  aiCache?: boolean | AiCacheConfig;
  /** Namespace for multi-tenancy. */
  namespace?: string;
  /** Maximum memory for L1 (bytes). */
  maxMemoryBytes?: number;
  /** Enable compression. */
  compression?: boolean | CompressionConfig;
  /** Enable background refresh (stale-while-revalidate). */
  backgroundRefresh?: boolean | BackgroundRefreshConfig;
  /** Enable cache warming. */
  warming?: boolean | WarmingConfig;
  /** Enable monitoring. */
  monitoring?: boolean;
  /** Enable AI performance advisor. */
  advisor?: boolean;
}

export interface MemoryCacheConfig {
  maxSize?: number;
  strategy?: EvictionStrategy;
  defaultTtl?: number;
  slidingTtl?: number;
}

export interface QueryCacheConfig {
  enabled?: boolean;
  defaultTtl?: number;
  /** Automatically detect cacheable queries. */
  autoDetect?: boolean;
  /** Cache introspection/reflection queries. */
  cacheMetadata?: boolean;
  /** Never cache queries containing these functions. */
  volatileFunctions?: string[];
}

export interface AiCacheConfig {
  /** Cache AI SQL generations. */
  sqlGeneration?: boolean;
  /** Cache AI schema summaries. */
  schemaSummaries?: boolean;
  /** Cache prompt completions. */
  completions?: boolean;
  /** Cache embeddings. */
  embeddings?: boolean;
  /** Default TTL for AI caches. */
  defaultTtl?: number;
}

export interface CompressionConfig {
  enabled?: boolean;
  /** Minimum size in bytes before compression kicks in. */
  minSize?: number;
  /** Algorithm: "gzip" | "brotli" | "lz4" | "zstd". */
  algorithm?: "gzip" | "brotli" | "lz4" | "zstd";
  /** Compression level (1-19, default 6). */
  level?: number;
}

export interface BackgroundRefreshConfig {
  /** Enable stale-while-revalidate. */
  enabled?: boolean;
  /** How long to serve stale data while refreshing. */
  staleTtl?: number;
  /** Maximum concurrent background refreshes. */
  maxConcurrent?: number;
}

export interface WarmingConfig {
  /** Enable automatic cache warming. */
  enabled?: boolean;
  /** Cron-style schedule or interval in ms. */
  interval?: number;
  /** Maximum keys to warm per cycle. */
  maxKeys?: number;
}

// ---------------------------------------------------------------------------
// Cache query result type (what the ORM sees)
// ---------------------------------------------------------------------------

export interface CacheQueryOptions {
  /** Enable caching for this query. */
  cache?: boolean | number | CacheSetOptions;
  /** Invalidate these tags after this query (write operations). */
  invalidateTags?: string[];
  /** Bypass all caches. */
  bypass?: boolean;
  /** Freshness: acceptable stale age in seconds. */
  freshness?: number;
}

// ---------------------------------------------------------------------------
// Cache statistics (for /api/studio/cache)
// ---------------------------------------------------------------------------

export interface CacheStats {
  l1?: CacheDriverStats;
  l2?: CacheDriverStats;
  query?: CacheStatsEntry[];
  metadata?: CacheDriverStats;
  auth?: CacheDriverStats;
  ai?: CacheDriverStats;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  memoryBytes: number;
  evictions: number;
  topKeys: { key: string; hits: number; ttl: number }[];
  topTags: { tag: string; count: number }[];
}

export interface CacheStatsEntry {
  key: string;
  hits: number;
  ttl: number;
  sizeBytes: number;
  namespace: string;
}

// ---------------------------------------------------------------------------
// Invalidation event (for pub/sub)
// ---------------------------------------------------------------------------

export interface InvalidationEvent {
  type: "invalidate" | "clear" | "warm";
  keys?: string[];
  tags?: string[];
  namespace?: string;
  timestamp: number;
  source: string;
}

// ---------------------------------------------------------------------------
// Lock interface
// ---------------------------------------------------------------------------

export interface CacheLock {
  /** Acquire a lock with the given key and TTL. Returns true if acquired. */
  acquire(key: string, ttlMs?: number): Promise<boolean>;
  /** Release the lock. */
  release(key: string): Promise<void>;
  /** Execute fn under a distributed lock. */
  withLock<T>(key: string, fn: () => Promise<T>, ttlMs?: number): Promise<T>;
}

// ---------------------------------------------------------------------------
// Cache policy decision (from AI advisor)
// ---------------------------------------------------------------------------

export interface CachePolicy {
  key: string;
  ttl: number;
  tags: string[];
  strategy: "write-through" | "write-behind" | "cache-aside" | "read-through";
  priority: "low" | "medium" | "high";
  reason: string;
}

// ---------------------------------------------------------------------------
// Plugin interface for custom cache drivers
// ---------------------------------------------------------------------------

export interface CachePlugin {
  name: string;
  createDriver(config?: unknown): CacheDriver;
}

// ---------------------------------------------------------------------------
// Query analysis — determines if a query is cacheable
// ---------------------------------------------------------------------------

export interface QueryCacheability {
  cacheable: boolean;
  reason?: string;
  /** Unique key derived from the query SQL + params. */
  cacheKey?: string;
  /** Tables this query touches (for invalidation). */
  tables: string[];
  /** Whether the query is deterministic. */
  deterministic: boolean;
  /** Estimated result size. */
  estimatedSize?: number;
}
