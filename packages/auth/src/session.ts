// MountSQLI — sessions & the Auth facade.
// Auth is intentionally storage-agnostic: it depends only on a small
// `TokenStore` interface (implemented by the app/driver), so it works with
// SQLite, Postgres, Redis, or an in-memory map in tests. This keeps
// @mountsqli/auth free of any driver dependency.

import { MountError } from "@mountsqli/driver";
import { hashPassword, verifyPassword, signJwt, verifyJwt, type SignOptions, type VerifyOptions, type JwtVerification } from "./crypto.js";
import { MemoryRateLimiter, type RateLimiter } from "./rate-limit.js";
import { Rbac } from "./rbac.js";
import type { Policy, PolicyContext } from "./policy.js";
import { DatabaseSync } from "node:sqlite";
import { traceSpan } from "./trace.js";

export interface SessionRecord {
  token: string;
  userId: string | number;
  expiresAt: number; // epoch ms
}

export interface TokenStore {
  save(session: SessionRecord): Promise<void> | void;
  load(token: string): Promise<SessionRecord | null> | SessionRecord | null;
  revoke(token: string): Promise<void> | void;
}

export class MemoryTokenStore implements TokenStore {
  private map = new Map<string, SessionRecord>();
  save(s: SessionRecord): void {
    this.map.set(s.token, s);
  }
  load(t: string): SessionRecord | null {
    return this.map.get(t) ?? null;
  }
  revoke(t: string): void {
    this.map.delete(t);
  }
}

/**
 * SQLite-backed token store — sessions survive restarts.
 * Uses node:sqlite's DatabaseSync (synchronous, but fast for session lookups).
 * Creates the `_mount_sessions` table on first use.
 */
export class SqliteTokenStore implements TokenStore {
  private db: DatabaseSync;
  private stmts: {
    save: ReturnType<DatabaseSync["prepare"]>;
    load: ReturnType<DatabaseSync["prepare"]>;
    revoke: ReturnType<DatabaseSync["prepare"]>;
  };

  constructor(path?: string) {
    try {
      this.db = new DatabaseSync(path ?? ":memory:");
    } catch (e) {
      throw new MountError("CONNECTION", `MountSQLI auth: cannot open session database at "${path ?? ":memory:"}"`, { detail: (e as Error).message });
    }
    try {
      this.db.exec(`CREATE TABLE IF NOT EXISTS _mount_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`);
    } catch (e) {
      throw new MountError("CONNECTION", "MountSQLI auth: failed to create sessions table", { detail: (e as Error).message });
    }
    try {
      this.stmts = {
        save: this.db.prepare("INSERT OR REPLACE INTO _mount_sessions (token, user_id, expires_at) VALUES (?, ?, ?)"),
        load: this.db.prepare("SELECT token, user_id AS userId, expires_at AS expiresAt FROM _mount_sessions WHERE token = ?"),
        revoke: this.db.prepare("DELETE FROM _mount_sessions WHERE token = ?"),
      };
    } catch (e) {
      throw new MountError("CONNECTION", "MountSQLI auth: failed to prepare session statements", { detail: (e as Error).message });
    }
  }

  save(s: SessionRecord): void {
    this.stmts.save.run(s.token, String(s.userId), s.expiresAt);
  }

  load(t: string): SessionRecord | null {
    const row = this.stmts.load.get(t) as SessionRecord | undefined;
    return row ?? null;
  }

  revoke(t: string): void {
    this.stmts.revoke.run(t);
  }
}

/**
 * Postgres-backed token store — sessions survive restarts and scale across processes.
 * Accepts a `raw` function (like `db.raw()`) for executing SQL queries.
 */
export class PgTokenStore implements TokenStore {
  private raw: (sql: string, params?: unknown[]) => Promise<any[]>;
  private ready: Promise<void>;

  constructor(rawFn: (sql: string, params?: unknown[]) => Promise<any[]>) {
    this.raw = rawFn;
    this.ready = this._init();
  }

  private async _init(): Promise<void> {
    try {
      await this.raw(
        `CREATE TABLE IF NOT EXISTS _mount_sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at BIGINT NOT NULL
        )`
      );
    } catch { /* table may already exist */ }
  }

  async save(s: SessionRecord): Promise<void> {
    await this.ready;
    await this.raw(
      "INSERT INTO _mount_sessions (token, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (token) DO UPDATE SET user_id = $2, expires_at = $3",
      [s.token, String(s.userId), s.expiresAt],
    );
  }

  async load(token: string): Promise<SessionRecord | null> {
    await this.ready;
    const rows = await this.raw(
      "SELECT token, user_id AS \"userId\", expires_at AS \"expiresAt\" FROM _mount_sessions WHERE token = $1",
      [token],
    );
    return rows.length ? (rows[0] as SessionRecord) : null;
  }

  async revoke(token: string): Promise<void> {
    await this.ready;
    await this.raw("DELETE FROM _mount_sessions WHERE token = $1", [token]);
  }
}

export interface AuthConfig {
  /** JWT secret (HS256) or Ed25519 private key PEM (EdDSA). */
  jwtKey: string;
  jwtAlg?: "HS256" | "EdDSA";
  issuer?: string;
  audience?: string;
  /** Session lifetime in seconds (default 1 hour). */
  sessionTtlSec?: number;
  rbac?: Rbac;
  store?: TokenStore;
  /**
   * OPT-IN brute-force protection for the login path. When set, the facade
   * tracks failed logins per key (e.g. userId or IP) and locks the key out
   * after `maxAttempts` within `windowSec`, for `lockoutSec`.
   */
  rateLimit?: { windowSec: number; maxAttempts: number; lockoutSec: number };
  /**
   * OPT-IN shared rate limiter. Supply a `RateLimiter` implementation
   * (e.g. Redis-backed) here for multi-instance deploys — the in-memory
   * `MemoryRateLimiter` is per-process and resets on restart. When set,
   * it takes precedence over `rateLimit` (which builds a `MemoryRateLimiter`).
   */
  rateLimiter?: RateLimiter;
}

export interface AuthedUser {
  userId: string | number;
  roles: string[];
  claims: Record<string, unknown>;
}

export class Auth {
  readonly rbac: Rbac;
  private store: TokenStore;
  private limiter?: RateLimiter;

  constructor(private cfg: AuthConfig) {
    this.rbac = cfg.rbac ?? new Rbac();
    this.store = cfg.store ?? new MemoryTokenStore();
    this.limiter = cfg.rateLimiter ?? (cfg.rateLimit ? new MemoryRateLimiter(cfg.rateLimit) : undefined);
  }

  hashPassword(pw: string): string {
    return hashPassword(pw);
  }
  verifyPassword(pw: string, stored: string): boolean {
    return verifyPassword(pw, stored);
  }

  /**
   * Brute-force guard for the login path (OPT-IN via `AuthConfig.rateLimit`).
   * Call `recordLoginFailure(key)` on a failed password check and
   * `clearLoginFailures(key)` after a successful login. `key` is typically a
   * username or client IP. When the key is locked out, `isLockedOut(key)`
   * returns true and you should short-circuit the login attempt.
   */
  isLockedOut(key: string): boolean {
    return this.limiter ? this.limiter.isLocked(key) : false;
  }
  recordLoginFailure(key: string): void {
    this.limiter?.recordFailure(key);
  }
  clearLoginFailures(key: string): void {
    this.limiter?.reset(key);
  }

  /** Issue a JWT + persisted session for a verified user. */
  async login(user: AuthedUser): Promise<{ token: string; expiresAt: number }> {
    const ttl = this.cfg.sessionTtlSec ?? 3600;
    const token = signJwt(
      { sub: String(user.userId), roles: user.roles, ...user.claims },
      { key: this.cfg.jwtKey, alg: this.cfg.jwtAlg ?? "HS256", expiresInSec: ttl, issuer: this.cfg.issuer, audience: this.cfg.audience },
    );
    const expiresAt = Date.now() + ttl * 1000;
    await this.store.save({ token, userId: user.userId, expiresAt });
    return { token, expiresAt };
  }

  async logout(token: string): Promise<void> {
    await this.store.revoke(token);
  }

  /** Verify a bearer token: signature + store presence + expiry. */
  async authenticate(token: string): Promise<{ ok: boolean; user?: AuthedUser; reason?: string }> {
    return traceSpan("auth.authenticate", { "auth.token_prefix": token.slice(0, 8) }, async () => {
      const v = verifyJwt(token, { key: this.cfg.jwtKey, issuer: this.cfg.issuer, audience: this.cfg.audience });
      if (!v.ok) return { ok: false, reason: v.reason };
      const session = await this.store.load(token);
      if (!session) return { ok: false, reason: "no-session" };
      if (session.expiresAt < Date.now()) return { ok: false, reason: "session-expired" };
      const p = v.payload!;
      return {
        ok: true,
        user: {
          userId: p.sub as string,
          roles: (p.roles as string[]) ?? [],
          claims: stripReserved(p),
        },
      };
    });
  }

  /** Build the PolicyContext used by RLS from an authenticated user. */
  policyContext(user: AuthedUser | null): PolicyContext {
    if (!user) return {};
    return { userId: user.userId, roles: user.roles, claims: user.claims };
  }

  can(roles: string[], permission: string): boolean {
    return this.rbac.canWildcard(roles, permission);
  }
}

function stripReserved(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (["sub", "roles", "iat", "exp", "iss", "aud"].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export type { Policy, PolicyContext, SignOptions, VerifyOptions, JwtVerification };
