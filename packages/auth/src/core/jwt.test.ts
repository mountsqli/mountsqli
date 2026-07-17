import { describe, it, expect } from 'vitest';
import { createToken, verifyToken, decodeToken } from './jwt.js';

const TEST_SECRET = 'test-secret-key-for-jwt-testing';

describe('JWT', () => {
  it('should create a valid JWT token', async () => {
    const token = await createToken(
      { sub: 'user-123', email: 'test@example.com' },
      TEST_SECRET,
    );
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('should verify a valid token', async () => {
    const token = await createToken(
      { sub: 'user-123', email: 'test@example.com', name: 'Test User' },
      TEST_SECRET,
    );
    const payload = await verifyToken(token, TEST_SECRET);
    expect(payload).toBeTruthy();
    expect(payload?.sub).toBe('user-123');
    expect(payload?.email).toBe('test@example.com');
    expect(payload?.name).toBe('Test User');
  });

  it('should reject an invalid token', async () => {
    const payload = await verifyToken('invalid.token.here', TEST_SECRET);
    expect(payload).toBeNull();
  });

  it('should reject a token with wrong secret', async () => {
    const token = await createToken(
      { sub: 'user-123', email: 'test@example.com' },
      TEST_SECRET,
    );
    const payload = await verifyToken(token, 'wrong-secret');
    expect(payload).toBeNull();
  });

  it('should decode a token without verification', () => {
    const payload = decodeToken(
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSJ9.signature'
    );
    expect(payload).toBeTruthy();
    expect(payload?.sub).toBe('user-123');
  });

  it('should include iat and exp in payload', async () => {
    const token = await createToken(
      { sub: 'user-123', email: 'test@example.com' },
      TEST_SECRET,
    );
    const payload = await verifyToken(token, TEST_SECRET);
    expect(payload?.iat).toBeDefined();
    expect(payload?.exp).toBeDefined();
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });
});
