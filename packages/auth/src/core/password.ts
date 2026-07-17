/**
 * Password hashing using Node.js scrypt (built-in, no native deps).
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const SALT_LENGTH = 32;
const HASH_LENGTH = 64;

/**
 * Hash a password using scrypt.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(password, salt, HASH_LENGTH);
  return `$scrypt$${salt.toString('hex')}$${(hash as Buffer).toString('hex')}`;
}

/**
 * Verify a password against a hash.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith('$scrypt$')) return false;

  const [, , saltHex, storedHashHex] = hash.split('$');
  if (!saltHex || !storedHashHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const storedHash = Buffer.from(storedHashHex, 'hex');
  const computedHash = (await scryptAsync(password, salt, HASH_LENGTH)) as Buffer;

  if (computedHash.length !== storedHash.length) return false;
  return timingSafeEqual(computedHash, storedHash);
}
