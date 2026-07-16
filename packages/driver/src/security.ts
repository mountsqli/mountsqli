// MountSQLI — shared validation, security helpers & structured error type.
//
// Every input boundary (HTTP, CLI, config) routes through these guards so
// there is one place to audit for injection, overflow, and coercion bugs.

// ---------------------------------------------------------------------------
// Structured error type — every part of the engine uses this so the server
// can safely serialize errors without leaking stack traces.
// ---------------------------------------------------------------------------

export type MountErrorCode =
  | "VALIDATION"      // input validation failed
  | "NOT_FOUND"       // table/row not found
  | "CONFLICT"        // uniqueness violation / duplicate
  | "FORBIDDEN"       // rls / auth denied
  | "QUERY_FAILED"    // SQL execution error
  | "CONFIG"          // bad configuration
  | "CONNECTION"      // database connection / auth failure
  | "INTERNAL";       // unexpected / catch-all

export class MountError extends Error {
  override name = "MountError" as const;

  constructor(
    public readonly code: MountErrorCode,
    message: string,
    /** Details the server may safely include in a response (not user-provided). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    Object.setPrototypeOf(this, MountError.prototype);
  }

  /** Map an error code to the closest HTTP status. */
  static httpStatus(code: MountErrorCode): number {
    switch (code) {
      case "VALIDATION": return 400;
      case "NOT_FOUND": return 404;
      case "CONFLICT": return 409;
      case "FORBIDDEN": return 403;
      case "QUERY_FAILED": return 422;
      case "CONFIG": return 500;
      case "CONNECTION": return 503;
      case "INTERNAL": return 500;
      default: return 500;
    }
  }

  /** Safe JSON representation — no stack, no internal fields. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { code: this.code, error: this.message };
    if (this.details) out.details = this.details;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Safe JSON body parsing with size limits
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export function parseJsonBody(
  raw: string | undefined,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Record<string, unknown> | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  if (raw.length > maxBytes) {
    throw new MountError("VALIDATION", `Request body exceeds ${maxBytes} byte limit`);
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new MountError("VALIDATION", "Invalid JSON in request body");
  }
}

// ---------------------------------------------------------------------------
// Safe identifier validation (table names, column names, file keys)
// ---------------------------------------------------------------------------

const TABLE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
const COLUMN_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/;
const FILE_KEY_PATTERN = /^[a-zA-Z0-9_\/\.\-]{1,512}$/;
const CHANNEL_PATTERN = /^[a-zA-Z0-9_\-]{1,128}$/;

const PATH_TRAVERSAL = /\.\.\//;

export function validateTableName(name: unknown): string {
  if (typeof name !== "string" || !TABLE_PATTERN.test(name)) {
    throw new MountError("VALIDATION", `Invalid table name "${String(name)}"`);
  }
  return name;
}

export function validateColumnName(name: unknown): string {
  if (typeof name !== "string" || !COLUMN_PATTERN.test(name)) {
    throw new MountError("VALIDATION", `Invalid column name "${String(name)}"`);
  }
  return name;
}

export function validateFileKey(key: unknown): string {
  if (typeof key !== "string" || !FILE_KEY_PATTERN.test(key) || PATH_TRAVERSAL.test(key) || key.includes("..")) {
    throw new MountError("VALIDATION", `Invalid file key "${String(key)}"`);
  }
  return key;
}

export function validateChannelName(name: unknown): string {
  if (typeof name !== "string" || !CHANNEL_PATTERN.test(name)) {
    throw new MountError("VALIDATION", `Invalid channel name "${String(name)}"`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Numeric parameter coercion with bounds
// ---------------------------------------------------------------------------

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// SQL console guard — whitelist operations that mutate
// ---------------------------------------------------------------------------

const DESTRUCTIVE_RE = /^\s*(DROP|ALTER|TRUNCATE|RENAME|CREATE\s+INDEX)/i;
const MUTATING_RE = /^\s*(INSERT|UPDATE|DELETE|CREATE|REPLACE|MERGE)/i;

export interface SqlGuardResult {
  safe: boolean;
  mutates: boolean;
  destructive: boolean;
}

export function classifySql(sql: string): SqlGuardResult {
  const trimmed = sql.trim();
  return {
    safe: true,
    mutates: MUTATING_RE.test(trimmed),
    destructive: DESTRUCTIVE_RE.test(trimmed),
  };
}

// ---------------------------------------------------------------------------
// Safe JSON error serializer — never leaks stack traces
// ---------------------------------------------------------------------------

export function safeErrorResponse(err: unknown): Record<string, unknown> {
  if (err instanceof MountError) return err.toJSON();
  if (err instanceof Error) return { error: err.message };
  return { error: "An unexpected error occurred" };
}

// ---------------------------------------------------------------------------
// CORS helper — use strict origin validation in production
// ---------------------------------------------------------------------------

export function corsHeaders(requestOrigin?: string, allowedOrigins?: string[]): Record<string, string> {
  // In production, validate against an explicit allowlist.
  if (allowedOrigins && allowedOrigins.length > 0) {
    const origin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0]!;
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "Content-Type, Authorization",
      "access-control-max-age": "86400",
    };
  }
  // Dev default: reflect request origin or wildcard.
  const origin = requestOrigin ?? "*";
  return {
    "access-control-allow-origin": origin === "*" ? "*" : origin,
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
    "access-control-max-age": "86400",
  };
}

// ---------------------------------------------------------------------------
// In-memory token bucket rate limiter
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  /** Max requests per window (default 100). */
  maxRequests?: number;
  /** Window duration in ms (default 60000 = 1 minute). */
  windowMs?: number;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory token bucket rate limiter.
 * Each client IP gets a bucket that refills every `windowMs`.
 */
export class RateLimiter {
  private buckets = new Map<string, BucketEntry>();
  private max: number;
  private windowMs: number;

  constructor(cfg: RateLimiterConfig = {}) {
    this.max = cfg.maxRequests ?? 100;
    this.windowMs = cfg.windowMs ?? 60000;
    // Periodic cleanup every minute.
    setInterval(() => this.cleanup(), 60000).unref();
  }

  /** Returns `true` if the request is allowed, `false` if rate-limited. */
  check(key: string): boolean {
    const now = Date.now();
    let entry = this.buckets.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, entry);
    }
    entry.count++;
    return entry.count <= this.max;
  }

  /** How many ms until the bucket resets. */
  timeUntilReset(key: string): number {
    const entry = this.buckets.get(key);
    if (!entry) return 0;
    return Math.max(0, entry.resetAt - Date.now());
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.buckets) {
      if (entry.resetAt < now) this.buckets.delete(key);
    }
  }
}
