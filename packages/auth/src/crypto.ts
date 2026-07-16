// MountSQLI — auth cryptography (zero external dependencies).
// Uses only node:crypto: scrypt for password hashing (constant-time
// compare) and JWT signing/verification (HS256 + EdDSA).

import { scryptSync, randomBytes, timingSafeEqual, createHash, sign, verify, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";

const SCRYPT_KEYLEN = 64;
// Cost factor N = 2^15 (32768) — well above node's 2^14 default for a real
// password-hashing margin against GPU/ASIC. Stored in the hash format so the
// cost can be raised later without breaking existing hashes (rehash-on-login).
const SCRYPT_COST = 15;
// scrypt memory = 128 * N * r = 128 * 32768 * 8 = 32MiB, which exceeds
// node's default 32MiB cap (strict). Allow up to 64MiB.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/**
 * Hash a password with scrypt + random salt.
 * Format: scrypt$<cost>$<saltHex>$<hashHex>  (cost lets us raise N later).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, { N: 2 ** SCRYPT_COST, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verify of a password against a stored scrypt hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  // legacy 3-part format (no cost) is still accepted
  if (parts[0] !== "scrypt") return false;
  let salt: Buffer, expected: Buffer, cost: number;
  if (parts.length === 4) {
    cost = parseInt(parts[1]!, 10);
    salt = Buffer.from(parts[2]!, "hex");
    expected = Buffer.from(parts[3]!, "hex");
  } else if (parts.length === 3) {
    cost = SCRYPT_COST;
    salt = Buffer.from(parts[1]!, "hex");
    expected = Buffer.from(parts[2]!, "hex");
  } else {
    return false;
  }
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN, { N: 2 ** cost, maxmem: SCRYPT_MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---- JWT (compact, dependency-free) ----

export interface JwtHeader {
  alg: "HS256" | "EdDSA";
  typ: "JWT";
}

function base64url(b: Buffer): string {
  return b.toString("base64url");
}
function b64urlJson(obj: unknown): string {
  return base64url(Buffer.from(JSON.stringify(obj)));
}

export interface SignOptions {
  /** Secret (HS256) or PEM private key (EdDSA). */
  key: string | Buffer;
  alg?: "HS256" | "EdDSA";
  expiresInSec?: number;
  issuer?: string;
  audience?: string;
}

/** Sign a JWT. Supports HS256 (shared secret) and EdDSA (Ed25519 PEM). */
export function signJwt(
  payload: Record<string, unknown>,
  opts: SignOptions,
): string {
  const header: JwtHeader = { alg: opts.alg ?? "HS256", typ: "JWT" } as JwtHeader;
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: payload.iat ?? now };
  if (opts.expiresInSec) (body as any).exp = now + opts.expiresInSec;
  if (opts.issuer) (body as any).iss = opts.issuer;
  if (opts.audience) (body as any).aud = opts.audience;

  const signingInput = `${b64urlJson(header)}.${b64urlJson(body)}`;
  let sig: Buffer;
  if (header.alg === "EdDSA") {
    const key = createPrivateKey(opts.key as string);
    sig = sign(null, Buffer.from(signingInput), key);
  } else {
    sig = createHash("sha256").update(signingInput).update(opts.key as string).digest();
  }
  return `${signingInput}.${base64url(sig)}`;
}

export interface VerifyOptions {
  key: string | Buffer;
  /** Algorithm hint (needed to pick EdDSA vs HS256). Defaults to HS256. */
  alg?: "HS256" | "EdDSA";
  issuer?: string;
  audience?: string;
  /** Allow a skew window in seconds (default 0). */
  leewaySec?: number;
}

export interface JwtVerification {
  ok: boolean;
  payload?: Record<string, unknown>;
  reason?: string;
}

/** Verify a JWT signature + standard claims. */
export function verifyJwt(token: string, opts: VerifyOptions): JwtVerification {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [h, p, s] = parts as [string, string, string];
  const signingInput = `${h}.${p}`;

  // Enforce the algorithm from the SERVER config, never from the token header.
  // Accepting the header's alg enables algorithm-confusion attacks (e.g. forging
  // an EdDSA token against an HS256 secret, or vice-versa).
  const expectedAlg = opts.alg ?? "HS256";
  let headerAlg: string;
  try {
    headerAlg = (JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string }).alg;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (headerAlg !== expectedAlg) return { ok: false, reason: "bad-algorithm" };

  let sig: Buffer;
  try {
    if (expectedAlg === "EdDSA") {
      const key = createPublicKey(opts.key as string);
      sig = Buffer.from(s, "base64url");
      if (!verify(null, Buffer.from(signingInput), key, sig)) return { ok: false, reason: "bad-signature" };
    } else {
      sig = createHash("sha256").update(signingInput).update(opts.key as string).digest();
      const given = Buffer.from(s, "base64url");
      if (sig.length !== given.length || !timingSafeEqual(sig, given)) return { ok: false, reason: "bad-signature" };
    }
  } catch {
    return { ok: false, reason: "bad-signature" };
  }
  const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  const leeway = opts.leewaySec ?? 0;
  if (typeof payload.exp === "number" && payload.exp < now - leeway) return { ok: false, reason: "expired" };
  if (opts.issuer && payload.iss !== opts.issuer) return { ok: false, reason: "bad-issuer" };
  if (opts.audience && payload.aud !== opts.audience) return { ok: false, reason: "bad-audience" };
  return { ok: true, payload };
}

/** Generate an Ed25519 keypair as PEM (for EdDSA JWT). */
export function generateEddsaKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) as string, publicKey: publicKey.export({ type: "spki", format: "pem" }) as string };
}
