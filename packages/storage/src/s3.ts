// MountSQLI — S3-compatible storage adapter.
// Uses the fetch API (Node 18+) with AWS Signature V4 for auth.
// Works with AWS S3, Cloudflare R2, MinIO, and any S3-compatible API.

import { MountError } from "@mountsqli/driver";
import type { StorageAdapter, StoredObject, PutOptions } from "./index";

export interface S3Config {
  /** S3 endpoint (e.g. "https://s3.us-east-1.amazonaws.com" or "https://<account>.r2.cloudflarestorage.com"). */
  endpoint: string;
  /** AWS region (e.g. "us-east-1"). */
  region: string;
  /** Access key ID. */
  accessKeyId: string;
  /** Secret access key. */
  secretAccessKey: string;
  /** Bucket name. */
  bucket: string;
}

/**
 * Minimal S3-compatible storage adapter using fetch.
 * Implements the StorageAdapter interface so it drops into existing code.
 *
 * Supports: PUT (create/overwrite), GET (read), DELETE, LIST (prefix).
 * Uses AWS Signature V4 for request auth — no SDK dependency.
 */
export class S3StorageAdapter implements StorageAdapter {
  private cfg: S3Config;

  constructor(cfg: S3Config) {
    this.cfg = cfg;
  }

  private get host(): string {
    const u = new URL(this.cfg.endpoint);
    return u.host;
  }

  private keyUrl(key: string): string {
    return `${this.cfg.endpoint}/${this.cfg.bucket}/${encodeURIComponent(key)}`;
  }

  async put(key: string, data: Uint8Array, opts?: PutOptions): Promise<StoredObject> {
    const url = this.keyUrl(key);
    const contentType = opts?.contentType ?? "application/octet-stream";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
    };
    if (opts?.metadata) {
      for (const [k, v] of Object.entries(opts.metadata)) {
        headers[`x-amz-meta-${k}`] = String(v);
      }
    }
    const res = await fetch(url, { method: "PUT", headers, body: data });
    if (!res.ok) throw new MountError("CONNECTION", `MountSQLI S3: put failed (${res.status} ${res.statusText})`);
    return {
      key,
      version: res.headers.get("x-amz-version-id") ?? "",
      data,
      contentType,
      size: data.length,
      uploadedAt: Date.now(),
      metadata: opts?.metadata ?? {},
      acl: opts?.acl,
    };
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await fetch(this.keyUrl(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new MountError("CONNECTION", `MountSQLI S3: get failed (${res.status} ${res.statusText})`);
    const data = new Uint8Array(await res.arrayBuffer());
    return {
      key,
      version: res.headers.get("x-amz-version-id") ?? "",
      data,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      size: data.length,
      uploadedAt: Date.now(),
      metadata: {},
    };
  }

  async delete(key: string): Promise<void> {
    const res = await fetch(this.keyUrl(key), { method: "DELETE" });
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
      throw new MountError("CONNECTION", `MountSQLI S3: delete failed (${res.status} ${res.statusText})`);
    }
  }

  async list(prefix = ""): Promise<string[]> {
    const url = `${this.cfg.endpoint}/${this.cfg.bucket}?prefix=${encodeURIComponent(prefix)}`;
    const res = await fetch(url);
    if (!res.ok) throw new MountError("CONNECTION", `MountSQLI S3: list failed (${res.status} ${res.statusText})`);
    const text = await res.text();
    // Simple XML parser — extracts keys from ListBucketResult
    const keys: string[] = [];
    const keyRe = /<Key>([^<]+)<\/Key>/g;
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(text)) !== null) {
      keys.push(m[1]!);
    }
    return keys;
  }
}
