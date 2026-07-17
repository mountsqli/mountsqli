import { describe, it, expect } from 'vitest';
import { generateSecret, generateCode, verifyCode, generateURI } from './totp.js';

describe('TOTP', () => {
  it('should generate a secret', () => {
    const secret = generateSecret();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(0);
  });

  it('should generate different secrets', () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    expect(s1).not.toBe(s2);
  });

  it('should generate a 6-digit code', () => {
    const secret = generateSecret();
    const code = generateCode(secret);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('should verify a valid code', () => {
    const secret = generateSecret();
    const code = generateCode(secret);
    const valid = verifyCode(secret, code);
    expect(valid).toBe(true);
  });

  it('should reject an invalid code', () => {
    const secret = generateSecret();
    const valid = verifyCode(secret, '000000');
    expect(valid).toBe(false);
  });

  it('should generate a valid OTP auth URI', () => {
    const secret = generateSecret();
    const uri = generateURI(secret, 'user@example.com', 'MyApp');
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=');
    expect(uri).toContain('issuer=MyApp');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('should support custom config', () => {
    const secret = generateSecret();
    const code = generateCode(secret, Date.now(), { digits: 8, period: 60 });
    expect(code).toMatch(/^\d{8}$/);
  });
});
