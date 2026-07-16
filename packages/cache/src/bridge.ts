// MountSQLI — Cache / ORM integration bridge.
//
// Provides the `withCache` wrapper that the query builder calls transparently.
// Also provides the tag-based invalidation helpers the ORM uses after writes.

import type { QueryPlan } from "@mountsqli/compiler";
import { CacheManager } from "./manager.js";
import { QueryCacheAnalyzer, buildCacheKey } from "./query.js";
import type { CacheQueryOptions } from "./types.js";

export interface WithCacheResult<T> {
  rows: T[];
  /** Whether the result came from cache. */
  fromCache: boolean;
  /** The cache key used (if cached). */
  cacheKey?: string;
}

export class CacheBridge {
  readonly manager: CacheManager;
  readonly analyzer: QueryCacheAnalyzer;

  constructor(manager?: CacheManager) {
    this.manager = manager ?? new CacheManager();
    this.analyzer = new QueryCacheAnalyzer();
  }

  /**
   * Attempt to resolve a query plan through the cache. Called by the query
   * builder's `.all()`, `.one()`, `.run()` methods.
   *
   * If the query is cacheable and a cache entry exists, returns cached rows.
   * Otherwise, executes the query, caches the result (if applicable), and returns.
   */
  async resolvePlan<T = unknown>(
    plan: QueryPlan,
    execute: () => Promise<{ rows: T[] }>,
    opts?: CacheQueryOptions,
  ): Promise<WithCacheResult<T>> {
    // Bypass requested
    if (opts?.bypass) {
      const { rows } = await execute();
      return { rows, fromCache: false };
    }

    // Check if the query is cacheable
    const analysis = this.analyzer.analyze(plan);
    const cacheable = opts?.cache !== undefined ? opts.cache : analysis.cacheable;

    if (!cacheable || !analysis.cacheKey) {
      const { rows } = await execute();
      return { rows, fromCache: false };
    }

    const cacheKey = analysis.cacheKey;
    let cacheOpts: any;

    if (typeof opts?.cache === "number") {
      cacheOpts = { ttl: opts.cache };
    } else if (typeof opts?.cache === "object" && !Array.isArray(opts.cache)) {
      cacheOpts = opts.cache;
    } else {
      cacheOpts = { ttl: undefined, tags: analysis.tables };
    }

    // Try to resolve from cache
    const cached = await this.manager.get<T[]>(cacheKey);
    if (cached !== undefined) {
      return { rows: cached, fromCache: true, cacheKey };
    }

    // Miss — execute and populate
    const { rows } = await execute();

    if (rows !== undefined) {
      await this.manager.set(cacheKey, rows, cacheOpts);
    }

    return { rows, fromCache: false, cacheKey };
  }

  /**
   * Called after a write operation (INSERT/UPDATE/DELETE) to invalidate
   * the relevant cache entries. Tags match the table names touched.
   */
  async invalidateAfterWrite(plan: QueryPlan): Promise<void> {
    const tables = this.analyzer.analyze(plan).tables;
    for (const table of tables) {
      await this.manager.invalidateTag(table);
    }

    // Also directly invalidate the plan's cache key if it exists
    const key = buildCacheKey(plan.table ?? "write", []);
    await this.manager.delete(key);
  }

  /** Invalidate by tag (public API). */
  async invalidateTag(tag: string): Promise<number> {
    return this.manager.invalidateTag(tag);
  }

  /** Invalidate by tags (public API). */
  async invalidateTags(tags: string[]): Promise<number> {
    let count = 0;
    for (const tag of tags) {
      count += await this.manager.invalidateTag(tag);
    }
    return count;
  }

  /** Clear all cache (or namespace). */
  async clear(namespace?: string): Promise<void> {
    return this.manager.clear(namespace);
  }

  /** Get cache statistics. */
  async stats() {
    return this.manager.stats();
  }

  /** Close cache connections. */
  async close(): Promise<void> {
    return this.manager.close();
  }
}
