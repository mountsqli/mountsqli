// MountSQLI — Storage engine.
//
// A uniform Storage interface backed by pluggable adapters (in-memory for
// tests, FileSystem / S3 / R2 / LibSQL-blob in production). Objects are
// content-addressed (versioned by hash) so URLs are immutable + CDN-friendly,
// while private objects get HMAC-signed, expiring URLs. This matches
// plan.md §12.

import { createHash, createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { MountError } from "@mountsqli/driver";
import { compilePolicy, type Policy, type PolicyContext } from "@mountsqli/auth";
import type { FilterNode } from "@mountsqli/compiler";

/**
 * Access-control attributes stored alongside an object. These are the columns
 * a storage RLS policy reads. They are intentionally flat + string-keyed so
 * they round-trip through any adapter (incl. S3 metadata headers).
 */
export interface ObjectAcl {
  /** Owning subject id (stringified). Empty = no owner. */
  owner?: string;
  /** Tenant id for multi-tenant isolation. Empty = none. */
  tenant?: string;
  /** "public" | "private" | "tenant". Defaults to "private" when an owner is set. */
  visibility?: "public" | "private" | "tenant";
  /** Extra roles/claims granted on this object (comma-joined). */
  roles?: string;
}

export interface StoredObject {
  key: string;
  version: string; // content hash (content-addressed versioning)
  data: Uint8Array;
  contentType: string;
  size: number;
  uploadedAt: number;
  metadata: Record<string, string>;
  /** Access-control attributes (plan.md §12: object ACLs as RLS policies). */
  acl?: ObjectAcl;
}

/** A storage access policy is just an `auth.Policy` over the object ACL. */
export type StoragePolicy = Policy;

export interface PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  /** Access-control attributes applied to the stored object (plan.md §12). */
  acl?: ObjectAcl;
}

export interface StorageAdapter {
  put(key: string, data: Uint8Array, opts?: PutOptions): Promise<StoredObject>;
  get(key: string, version?: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

// ---- adapters ----

export class MemoryStorage implements StorageAdapter {
  private map = new Map<string, StoredObject>();

  async put(key: string, data: Uint8Array, opts?: PutOptions): Promise<StoredObject> {
    const version = contentHash(data);
    const obj: StoredObject = {
      key,
      version,
      data,
      contentType: opts?.contentType ?? "application/octet-stream",
      size: data.length,
      uploadedAt: Date.now(),
      metadata: opts?.metadata ?? {},
      acl: opts?.acl,
    };
    this.map.set(key, obj);
    return obj;
  }
  async get(key: string): Promise<StoredObject | null> {
    return this.map.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ---- signed URLs (HMAC, expiring) ----

export interface SignedUrlOptions {
  expiresInSec: number;
  method?: "GET" | "PUT";
}

export class Storage {
  constructor(private adapter: StorageAdapter, private secret: string, private baseUrl = "https://cdn.mountsqli.dev") {}

  async upload(key: string, data: Uint8Array, opts?: PutOptions): Promise<StoredObject> {
    return this.adapter.put(key, data, opts);
  }

  async download(key: string, version?: string): Promise<StoredObject | null> {
    return this.adapter.get(key, version);
  }

  async remove(key: string): Promise<void> {
    return this.adapter.delete(key);
  }

  list(prefix?: string): Promise<string[]> {
    return this.adapter.list(prefix);
  }

  /** Immutable, CDN-friendly public URL for a versioned object. */
  publicUrl(key: string, version: string): string {
    return `${this.baseUrl}/${encodeURIComponent(key)}/${version}`;
  }

  /** HMAC-signed, expiring URL for a private object. */
  signUrl(key: string, opts: SignedUrlOptions): string {
    const exp = Math.floor(Date.now() / 1000) + opts.expiresInSec;
    const method = opts.method ?? "GET";
    const payload = `${method}\n${key}\n${exp}`;
    const sig = createHmac("sha256", this.secret).update(payload).digest("hex").slice(0, 32);
    const q = `?expires=${exp}&sig=${sig}&method=${method}`;
    return `${this.baseUrl}/${encodeURIComponent(key)}${q}`;
  }

  /** Verify a signed URL (used by the serving layer). Returns true if valid + unexpired. */
  verifySignedUrl(key: string, expires: number, sig: string, method: string): boolean {
    if (Math.floor(Date.now() / 1000) > expires) return false;
    const payload = `${method}\n${key}\n${expires}`;
    const expected = createHmac("sha256", this.secret).update(payload).digest("hex").slice(0, 32);
    // Timing-safe compare — a plain `===` leaks the HMAC byte-by-byte,
    // letting an attacker forge a valid signature character by character.
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // ---- access-controlled variants (plan.md §12: object ACLs as RLS) ----

  /**
   * Evaluate a storage policy against an object for a subject.
   *
   * The policy is authored with the same DSL as row-level security, e.g.
   * `allowOwner("owner")` or `allowTenant("tenant")`. We compile it against the
   * *subject's* context (resolving `equalsContext` to the subject's claims),
   * which yields FilterNodes like `{ column: "owner", op: "=", value: <userId> }`.
   * A `deny` means the subject fails the policy (e.g. anonymous). Otherwise each
   * filter must hold against the object's stored ACL (`obj.acl[column] === value`).
   */
  canAccess(obj: StoredObject, subject: PolicyContext, policy?: StoragePolicy): boolean {
    if (!policy) return true; // no policy = open access
    const { deny, filters } = compilePolicy(policy, subject);
    if (deny) return false;
    const acl = obj.acl ?? {};
    return filters.every((f: FilterNode) => {
      if (f.kind !== "filter") return true;
      return String((acl as Record<string, unknown>)[f.column] ?? "") === String(f.value ?? "");
    });
  }

  /** Download, gated by an optional storage policy. Returns null if denied. */
  async downloadSecure(
    key: string,
    subject: PolicyContext,
    policy?: StoragePolicy,
    version?: string,
  ): Promise<StoredObject | null> {
    const obj = await this.adapter.get(key, version);
    if (!obj) return null;
    if (policy && !this.canAccess(obj, subject, policy)) return null;
    return obj;
  }

  /** Remove, gated by an optional storage policy. Returns false if denied. */
  async removeSecure(key: string, subject: PolicyContext, policy?: StoragePolicy): Promise<boolean> {
    const obj = await this.adapter.get(key);
    if (!obj) return false;
    if (policy && !this.canAccess(obj, subject, policy)) return false;
    await this.adapter.delete(key);
    return true;
  }

  /** List keys, filtered to those the subject may access under the policy. */
  async listSecure(
    prefix: string,
    subject: PolicyContext,
    policy?: StoragePolicy,
  ): Promise<string[]> {
    const all = await this.adapter.list(prefix);
    if (!policy) return all;
    const out: string[] = [];
    for (const key of all) {
      const obj = await this.adapter.get(key);
      if (obj && this.canAccess(obj, subject, policy)) out.push(key);
    }
    return out;
  }
}

export { S3StorageAdapter } from "./s3.js";
export type { S3Config } from "./s3.js";

// ---- content-addressing + transforms ----

export function contentHash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

export type Transform = (input: Uint8Array, contentType: string) => Uint8Array;

/**
 * On-the-fly transform (image resize/compress in production). Pure: takes a
 * stored object, applies a transform, returns a NEW versioned object.
 */
export async function transform(
  storage: Storage,
  key: string,
  fn: Transform,
  contentType = "application/octet-stream",
): Promise<StoredObject> {
  const obj = await storage.download(key);
  if (!obj) throw new MountError("NOT_FOUND", `MountSQLI storage: ${key} not found`);
  const out = fn(obj.data, obj.contentType);
  return storage.upload(`${key}@transformed`, out, { contentType, metadata: { source: key, sourceVersion: obj.version } });
}

/** Generate a random object key (e.g. for uploads). */
export function randomKey(prefix = "obj"): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
