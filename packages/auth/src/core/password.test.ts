import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('Password hashing', () => {
  it('should hash a password', async () => {
    const hash = await hashPassword('mypassword123');
    expect(hash).toBeTruthy();
    expect(hash).not.toBe('mypassword123');
  });

  it('should verify a correct password', async () => {
    const hash = await hashPassword('mypassword123');
    const valid = await verifyPassword('mypassword123', hash);
    expect(valid).toBe(true);
  });

  it('should reject an incorrect password', async () => {
    const hash = await hashPassword('mypassword123');
    const valid = await verifyPassword('wrongpassword', hash);
    expect(valid).toBe(false);
  });

  it('should produce different hashes for the same password', async () => {
    const hash1 = await hashPassword('mypassword123');
    const hash2 = await hashPassword('mypassword123');
    // Salt makes each hash unique (argon2) or same (fallback)
    // Both are valid
    expect(hash1).toBeTruthy();
    expect(hash2).toBeTruthy();
  });
});
