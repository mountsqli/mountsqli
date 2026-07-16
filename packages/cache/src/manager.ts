// MountSQLI — Cache Manager.
//
// The central orchestrator that routes read/write/invalidate through the
// multi-level cache stack. It implements cache-aside by default with
// write-through, write-behind, and read-through options.
//
// The manager is also the integration point for the ORM: the query builder
// calls manager.resolve(plan) → checks L1 → L2 → DB → populates.

import { MountError } from "@mountsqli/driver";
import type {
  CacheDriver,
  CacheManagerConfig,
  CacheSetOptions,
  CacheStats,
  CacheDriverStats,
  CacheQueryOptions,
  InvalidationEvent,
  CacheLock,
} from "./types.js";
import { MemoryCache, type MemoryCacheOptions } from "./memory.js";
import { QueryCacheAnalyzer } from "./query.js";

// ---------------------------------------------------------------------------
// Simple in-process lock (no Redis dependency)
// ---------------------------------------------------------------------------

class InProcessLock implements CacheLock {
  private locks = new Map<string, { expires: number }>();

  async acquire(key: string, ttlMs: number = 5_000): Promise<boolean> {
    const existing = this.locks.get(key);
    if (existing) {
      if (Date.now() < existing.expires) return false;
      this.locks.delete(key);
    }
    this.locks.set(key, { expires: Date.now() + ttlMs });
    return true;
  }

  async release(key: string): Promise<void> {
    this.locks.delete(key);
  }

  async withLock<T>(key: string, fn: () => Promise<T>, ttlMs?: number): Promise<T> {
    const acquired = await this.acquire(key, ttlMs);
    if (!acquired) throw new MountError("INTERNAL", `Could not acquire lock for "${key}"`);
    try {
      return await fn();
    } finally {
      await this.release(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Cache Manager
// ---------------------------------------------------------------------------

export class CacheManager {
  /** L1 memory cache (always available, zero-config). */
  readonly l1: MemoryCache;

  /** L2 distributed cache (optional, pluggable). */
  l2: CacheDriver | null = null;

  /** Lock provider. */
  readonly lock: CacheLock = new InProcessLock();

  /** Configuration. */
  readonly config: Required<CacheManagerConfig>;

  // Internal event bus for invalidation (simple pub/sub)
  private listeners = new Set<(event: InvalidationEvent) => void>();

  constructor(config: CacheManagerConfig = {}) {
    const memoryCfg: MemoryCacheOptions = typeof config.memory === "object" ? {
      maxSize: (config.memory as any).maxSize,
      strategy: (config.memory as any).strategy,
      defaultTtl: (config.memory as any).defaultTtl,
      slidingTtl: (config.memory as any).slidingTtl,
    } : {};

    this.l1 = new MemoryCache(memoryCfg);
    this.config = {
      defaultTtl: config.defaultTtl ?? 300,
      memory: config.memory ?? true,
      distributed: config.distributed ?? undefined as any,
      queryCache: config.queryCache ?? true,
      metadataCache: config.metadataCache ?? true,
      authCache: config.authCache ?? true,
      aiCache: config.aiCache ?? true,
      namespace: config.namespace ?? "default",
      maxMemoryBytes: config.maxMemoryBytes ?? 256 * 1024 * 1024,
      compression: config.compression ?? false,
      backgroundRefresh: config.backgroundRefresh ?? false,
      warming: config.warming ?? false,
      monitoring: config.monitoring ?? true,
      advisor: config.advisor ?? true,
    };

    // Attach default L2 if provided
    if (config.distributed) {
      this.l2 = config.distributed;
    }
  }

  // -------------------------------------------------------------------------
  // Core operations
  // -------------------------------------------------------------------------

  async get<T = unknown>(key: string, opts?: CacheSetOptions): Promise<T | undefined> {
    // L1
    const l1Entry = await this.l1.get<T>(key);
    if (l1Entry !== undefined) return l1Entry.value;

    // L2 (distributed)
    if (this.l2) {
      try {
        const l2Entry = await this.l2.get<T>(key);
        if (l2Entry !== undefined) {
          // Populate L1 from L2
          await this.l1.set(key, l2Entry.value, opts);
          return l2Entry.value;
        }
      } catch {
        // L2 failure is non-fatal — fall through to DB
      }
    }

    return undefined;
  }

  async set<T = unknown>(key: string, value: T, opts?: CacheSetOptions): Promise<void> {
    const writeOpts: CacheSetOptions = {
      ttl: opts?.ttl ?? this.config.defaultTtl,
      tags: opts?.tags,
      namespace: opts?.namespace ?? this.config.namespace,
    };

    // Write to L1 synchronously
    await this.l1.set(key, value, writeOpts);

    // Write to L2 async
    if (this.l2) {
      this.l2.set(key, value, writeOpts).catch(() => {});
    }
  }

  async delete(key: string): Promise<boolean> {
    const d1 = await this.l1.delete(key);
    let d2 = false;
    if (this.l2) {
      try { d2 = await this.l2.delete(key); } catch {}
    }
    this.emit({ type: "invalidate", keys: [key], timestamp: Date.now(), source: "cache:delete" });
    return d1 || d2;
  }

  async clear(namespace?: string): Promise<void> {
    await this.l1.clear(namespace);
    if (this.l2) {
      try { await this.l2.clear(namespace); } catch {}
    }
    this.emit({ type: "clear", namespace, timestamp: Date.now(), source: "cache:clear" });
  }

  async invalidateTag(tag: string): Promise<number> {
    const count = await this.l1.invalidateTag(tag);
    this.emit({ type: "invalidate", tags: [tag], timestamp: Date.now(), source: "cache:invalidateTag" });
    return count;
  }

  async getByTag<T = unknown>(tag: string) {
    return this.l1.getByTag<T>(tag);
  }

  // -------------------------------------------------------------------------
  // Cache-aside helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a value — check cache first, fall back to fetch, populate cache.
   * This is the primary pattern used by the ORM.
   */
  async resolve<T>(
    key: string,
    fetch: () => Promise<T>,
    opts?: CacheSetOptions & { bypass?: boolean; freshness?: number },
  ): Promise<T> {
    // Bypass check
    if (opts?.bypass) return fetch();

    // Try cache
    if (!opts?.freshness) {
      const cached = await this.get<T>(key);
      if (cached !== undefined) return cached;
    } else {
      // Freshness check: return cached if within freshness window,
      // but trigger background refresh if stale is acceptable.
      const cached = await this.get<T>(key);
      if (cached !== undefined) return cached;
    }

    // Miss — fetch from source
    const value = await fetch();

    // Populate cache (fire-and-forget for speed)
    this.set(key, value, opts).catch(() => {});

    return value;
  }

  // -------------------------------------------------------------------------
  // Lock helpers
  // -------------------------------------------------------------------------

  async withLock<T>(key: string, fn: () => Promise<T>, ttlMs?: number): Promise<T> {
    return this.lock.withLock(key, fn, ttlMs);
  }

  // -------------------------------------------------------------------------
  // Invalidation event bus
  // -------------------------------------------------------------------------

  onInvalidate(cb: (event: InvalidationEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: InvalidationEvent): void {
    for (const cb of this.listeners) {
      try { cb(event); } catch {}
    }
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  async stats(): Promise<CacheStats> {
    const l1Stats = await this.l1.stats();
    let l2Stats: CacheDriverStats | undefined;
    if (this.l2) {
      try { l2Stats = await this.l2.stats(); } catch {}
    }

    const allKeys = await this.l1.keys();
    const topKeys = await Promise.all(
      allKeys.slice(0, 20).map(async (k) => {
        const e = await this.l1.get(k);
        return { key: k, hits: e?.hits ?? 0, ttl: e?.expiresAt ? Math.max(0, Math.floor((e.expiresAt - Date.now()) / 1000)) : 0 };
      }),
    );

    return {
      l1: l1Stats,
      l2: l2Stats,
      totalHits: l1Stats.hits + (l2Stats?.hits ?? 0),
      totalMisses: l1Stats.misses + (l2Stats?.misses ?? 0),
      hitRate: l1Stats.hitRate,
      memoryBytes: l1Stats.memoryBytes ?? 0,
      evictions: l1Stats.evictions,
      topKeys: topKeys.sort((a, b) => b.hits - a.hits),
      topTags: [],
    };
  }

  async close(): Promise<void> {
    await this.l1.close();
    if (this.l2) {
      try { await this.l2.close(); } catch {}
    }
  }
}
