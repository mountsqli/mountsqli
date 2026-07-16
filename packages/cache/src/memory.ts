// MountSQLI — L1 Memory Cache.
//
// An ultra-fast, zero-dependency in-memory cache with LRU/LFU/FIFO eviction,
// TTL/sliding expiration, tags, namespaces, compression, and metrics.
//
// Target latency: <1ms for hot entries.

import type { CacheDriver, CacheEntryMeta, CacheSetOptions, EvictionStrategy, CacheDriverStats } from "./types.js";

// ---------------------------------------------------------------------------
// Doubly-linked list node for O(1) LRU/LFU/FIFO operations
// ---------------------------------------------------------------------------

class ListNode<T = unknown> {
  key: string;
  meta: CacheEntryMeta<T>;
  prev: ListNode<T> | null = null;
  next: ListNode<T> | null = null;

  constructor(key: string, meta: CacheEntryMeta<T>) {
    this.key = key;
    this.meta = meta;
  }
}

// ---------------------------------------------------------------------------
// Memory cache implementation
// ---------------------------------------------------------------------------

export interface MemoryCacheOptions {
  /** Maximum number of entries (default 10000). */
  maxSize?: number;
  /** Eviction strategy (default "lru"). */
  strategy?: EvictionStrategy;
  /** Default TTL in seconds (default 300). 0 = no expiration. */
  defaultTtl?: number;
  /** Sliding TTL in seconds — resets on access (default 0 = disabled). */
  slidingTtl?: number;
  /** Maximum memory in bytes (default 256 MB). */
  maxMemoryBytes?: number;
  /** Minimum size in bytes before compression (default 1024). */
  compressionMinSize?: number;
  /** Cleanup interval in ms (default 30_000). */
  cleanupIntervalMs?: number;
}

export class MemoryCache implements CacheDriver {
  readonly name = "memory";
  readonly ready: Promise<void>;

  private map = new Map<string, ListNode>();
  private head: ListNode | null = null;
  private tail: ListNode | null = null;
  private opts: Required<MemoryCacheOptions>;

  // Metrics
  private hits = 0;
  private misses = 0;
  private evictionCount = 0;
  private totalBytes = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // LFU tracking: key → frequency
  private lfuFreq = new Map<string, number>();

  // Tag index: tag → Set<key>
  private tagIndex = new Map<string, Set<string>>();

  constructor(opts: MemoryCacheOptions = {}) {
    this.opts = {
      maxSize: opts.maxSize ?? 10_000,
      strategy: opts.strategy ?? "lru",
      defaultTtl: opts.defaultTtl ?? 300,
      slidingTtl: opts.slidingTtl ?? 0,
      maxMemoryBytes: opts.maxMemoryBytes ?? 256 * 1024 * 1024,
      compressionMinSize: opts.compressionMinSize ?? 1024,
      cleanupIntervalMs: opts.cleanupIntervalMs ?? 30_000,
    };
    this.ready = Promise.resolve();
    this.startCleanup();
  }

  // -----------------------------------------------------------------------
  // Core operations
  // -----------------------------------------------------------------------

  async get<T = unknown>(key: string): Promise<CacheEntryMeta<T> | undefined> {
    const node = this.map.get(key);
    if (!node) {
      this.misses++;
      return undefined;
    }

    // Check expiration
    if (node.meta.expiresAt > 0 && Date.now() > node.meta.expiresAt) {
      this.removeNode(node);
      this.misses++;
      return undefined;
    }

    this.hits++;
    node.meta.hits++;
    node.meta.lastAccessed = Date.now();
    node.meta.accessCount++;

    // Sliding TTL: reset expiration
    if (this.opts.slidingTtl > 0) {
      node.meta.expiresAt = Date.now() + this.opts.slidingTtl * 1000;
    }

    // LRU: move to head (most recently used)
    if (this.opts.strategy === "lru") {
      this.moveToHead(node);
    }

    return node.meta as CacheEntryMeta<T>;
  }

  async set<T = unknown>(key: string, value: T, opts?: CacheSetOptions): Promise<void> {
    const now = Date.now();
    const ttl = opts?.ttl ?? this.opts.defaultTtl;
    const expiresAt = ttl > 0 ? now + ttl * 1000 : 0;
    const namespace = opts?.namespace ?? "default";

    // Serialize and optionally compress
    const serialized = this.serialize(value);
    const sizeBytes = serialized.length;
    const compressed = false; // compression handled at a higher layer

    // Check memory limit — evict if necessary
    if (this.totalBytes + sizeBytes > this.opts.maxMemoryBytes) {
      this.evict(sizeBytes);
    }

    const meta: CacheEntryMeta<T> = {
      value,
      expiresAt,
      tags: opts?.tags ?? [],
      namespace,
      createdAt: now,
      lastAccessed: now,
      accessCount: 1,
      sizeBytes,
      compressed,
      hits: 0,
    };

    const existing = this.map.get(key);
    if (existing) {
      // Update in place
      this.totalBytes -= existing.meta.sizeBytes;
      existing.meta = meta;
      if (this.opts.strategy === "lru") this.moveToHead(existing);
    } else {
      // Check capacity
      if (this.map.size >= this.opts.maxSize) {
        this.evictOne();
      }

      const node = new ListNode(key, meta);
      this.map.set(key, node);
      this.pushHead(node);
    }

    this.totalBytes += sizeBytes;

    // Update tag index
    if (opts?.tags) {
      for (const tag of opts.tags) {
        let set = this.tagIndex.get(tag);
        if (!set) {
          set = new Set();
          this.tagIndex.set(tag, set);
        }
        set.add(key);
      }
    }

    // LFU: initialize frequency
    if (this.opts.strategy === "lfu") {
      this.lfuFreq.set(key, 1);
    }
  }

  async delete(key: string): Promise<boolean> {
    const node = this.map.get(key);
    if (!node) return false;
    this.totalBytes -= node.meta.sizeBytes;
    this.removeNode(node);
    this.map.delete(key);
    // Clean tag index
    for (const tag of node.meta.tags) {
      this.tagIndex.get(tag)?.delete(key);
    }
    return true;
  }

  async clear(namespace?: string): Promise<void> {
    if (!namespace) {
      this.map.clear();
      this.head = this.tail = null;
      this.lfuFreq.clear();
      this.tagIndex.clear();
      this.totalBytes = 0;
      this.hits = this.misses = this.evictionCount = 0;
      return;
    }

    // Namespace-scoped clear
    const toDelete: string[] = [];
    for (const [key, node] of this.map) {
      if (node.meta.namespace === namespace) toDelete.push(key);
    }
    for (const key of toDelete) await this.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }

  async size(): Promise<number> {
    return this.map.size;
  }

  async keys(pattern?: string): Promise<string[]> {
    if (!pattern) return [...this.map.keys()];
    const re = this.globToRegex(pattern);
    return [...this.map.keys()].filter((k) => re.test(k));
  }

  async increment(key: string, by: number = 1): Promise<number> {
    const existing = await this.get<number>(key);
    const val = (existing?.value ?? 0) + by;
    await this.set(key, val);
    return val;
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.map.clear();
    this.head = this.tail = null;
    this.lfuFreq.clear();
    this.tagIndex.clear();
  }

  async stats(): Promise<CacheDriverStats> {
    return {
      entries: this.map.size,
      memoryBytes: this.totalBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictionCount,
      hitRate: this.hits + this.misses > 0 ? this.hits / (this.hits + this.misses) : 0,
    };
  }

  // -----------------------------------------------------------------------
  // Tag operations
  // -----------------------------------------------------------------------

  /** Invalidate all entries tagged with `tag`. */
  async invalidateTag(tag: string): Promise<number> {
    const keys = this.tagIndex.get(tag);
    if (!keys) return 0;
    let count = 0;
    for (const key of keys) {
      if (await this.delete(key)) count++;
    }
    this.tagIndex.delete(tag);
    return count;
  }

  /** Return all entries for a tag (for inspection). */
  async getByTag<T = unknown>(tag: string): Promise<CacheEntryMeta<T>[]> {
    const keys = this.tagIndex.get(tag);
    if (!keys) return [];
    const results: CacheEntryMeta<T>[] = [];
    for (const key of keys) {
      const entry = await this.get<T>(key);
      if (entry) results.push(entry);
    }
    return results;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private pushHead(node: ListNode): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: ListNode): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
  }

  private moveToHead(node: ListNode): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.pushHead(node);
  }

  private evict(neededBytes: number): void {
    while (this.totalBytes + neededBytes > this.opts.maxMemoryBytes && this.map.size > 0) {
      this.evictOne();
    }
  }

  private evictOne(): void {
    if (!this.tail) return;

    let target: ListNode;

    switch (this.opts.strategy) {
      case "lfu": {
        // Find least-frequently used
        let minFreq = Infinity;
        let minNode: ListNode | null = null;
        for (const node of this.map.values()) {
          const freq = this.lfuFreq.get(node.key) ?? 0;
          if (freq < minFreq) {
            minFreq = freq;
            minNode = node;
          }
        }
        target = minNode ?? this.tail;
        break;
      }
      case "fifo":
        // Tail is the oldest FIFO entry
        target = this.tail;
        break;
      case "ttl-only":
        // Remove the entry closest to expiration
        target = this.nearestExpiring();
        break;
      case "lru":
      default:
        // Tail is LRU
        target = this.tail;
        break;
    }

    this.totalBytes -= target.meta.sizeBytes;
    this.removeNode(target);
    this.map.delete(target.key);
    this.lfuFreq.delete(target.key);
    for (const tag of target.meta.tags) {
      this.tagIndex.get(tag)?.delete(target.key);
    }
    this.evictionCount++;
  }

  private nearestExpiring(): ListNode {
    let minExpiry = Infinity;
    let minNode = this.tail!;
    for (const node of this.map.values()) {
      const exp = node.meta.expiresAt > 0 ? node.meta.expiresAt : Infinity;
      if (exp < minExpiry) {
        minExpiry = exp;
        minNode = node;
      }
    }
    return minNode;
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, node] of this.map) {
        if (node.meta.expiresAt > 0 && now > node.meta.expiresAt) {
          this.totalBytes -= node.meta.sizeBytes;
          this.removeNode(node);
          this.map.delete(key);
          this.lfuFreq.delete(key);
        }
      }
    }, this.opts.cleanupIntervalMs);

    // Allow the process to exit without waiting on this timer
    if (this.cleanupTimer && typeof this.cleanupTimer === "object" && "unref" in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref();
    }
  }

  private serialize(value: unknown): string {
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${regexStr}$`);
  }
}
