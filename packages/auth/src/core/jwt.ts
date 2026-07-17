/**
 * JWT creation and verification using jose.
 */

import { SignJWT, jwtVerify, type JWTPayload as JoseJWTPayload } from 'jose';
import type { JWTPayload } from '../types.js';

const encoder = new TextEncoder();

/**
 * Create a JWT token.
 */
export async function createToken(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  options?: { maxAge?: number },
): Promise<string> {
  const secretKey = encoder.encode(secret);
  const maxAge = options?.maxAge ?? 30 * 24 * 60 * 60; // 30 days

  return new SignJWT(payload as unknown as JoseJWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(secretKey);
}

/**
 * Verify and decode a JWT token.
 */
export async function verifyToken(
  token: string,
  secret: string,
): Promise<JWTPayload | null> {
  try {
    const secretKey = encoder.encode(secret);
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Decode a JWT without verification (for debugging).
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return payload as JWTPayload;
  } catch {
    return null;
  }
}
