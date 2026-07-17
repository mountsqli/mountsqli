/**
 * TOTP (Time-based One-Time Password) 2FA implementation.
 * Uses HMAC-SHA1 based TOTP as per RFC 6238.
 */

import { createHmac, randomBytes } from 'node:crypto';

export interface TOTPConfig {
  /** Number of digits in the code (default: 6) */
  digits?: number;
  /** Time step in seconds (default: 30) */
  period?: number;
  /** Algorithm (default: 'sha1') */
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

/**
 * Generate a random TOTP secret.
 */
export function generateSecret(length = 20): string {
  return randomBytes(length).toString('base64url');
}

/**
 * Generate a TOTP code for a given secret and timestamp.
 */
export function generateCode(
  secret: string,
  timestamp?: number,
  config?: TOTPConfig,
): string {
  const digits = config?.digits ?? 6;
  const period = config?.period ?? 30;
  const algorithm = config?.algorithm ?? 'sha1';

  // timestamp is in milliseconds; convert to seconds, then divide by period
  const time = Math.floor((timestamp ?? Date.now()) / 1000 / period);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(0, 0);
  timeBuffer.writeUInt32BE(time, 4);

  const secretBuffer = Buffer.from(secret, 'base64url');
  const hmac = createHmac(algorithm, secretBuffer).update(timeBuffer).digest();

  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(code % 10 ** digits).padStart(digits, '0');
}

/**
 * Verify a TOTP code against a secret.
 * Allows for ±1 time step drift.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyCode(
  secret: string,
  code: string,
  config?: TOTPConfig,
): boolean {
  const period = config?.period ?? 30;
  const digits = config?.digits ?? 6;
  const now = Math.floor(Date.now() / 1000);

  // Check current and adjacent time steps
  for (const drift of [-1, 0, 1]) {
    const timestamp = (now + drift * period) * 1000;
    const expectedCode = generateCode(secret, timestamp, config);

    // Timing-safe comparison
    const expectedBuf = Buffer.from(expectedCode.padEnd(digits, '0'));
    const inputBuf = Buffer.from(code.padEnd(digits, '0'));

    if (expectedBuf.length === inputBuf.length) {
      const { timingSafeEqual } = require('node:crypto');
      if (timingSafeEqual(expectedBuf, inputBuf)) return true;
    }
  }

  return false;
}

/**
 * Generate a TOTP URI for QR code generation.
 */
export function generateURI(
  secret: string,
  email: string,
  issuer: string = 'MountSQLi',
  config?: TOTPConfig,
): string {
  const digits = config?.digits ?? 6;
  const period = config?.period ?? 30;
  const algorithm = config?.algorithm ?? 'sha1';

  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);

  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=${algorithm.toUpperCase()}&digits=${digits}&period=${period}`;
}
