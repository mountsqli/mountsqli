import { describe, it, expect } from 'vitest';
import {
  AuthError,
  UnauthorizedError,
  ForbiddenError,
  InvalidCredentialsError,
  UserNotFoundError,
  EmailAlreadyExistsError,
  InvalidTokenError,
  TwoFactorRequiredError,
  TwoFactorInvalidError,
  SessionExpiredError,
  ProviderError,
} from './errors.js';

describe('Auth errors', () => {
  it('AuthError should be an Error', () => {
    const err = new AuthError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AuthError');
  });

  it('UnauthorizedError should be an AuthError', () => {
    const err = new UnauthorizedError();
    expect(err).toBeInstanceOf(AuthError);
    expect(err.name).toBe('UnauthorizedError');
    expect(err.message).toBe('Unauthorized');
  });

  it('ForbiddenError should be an AuthError', () => {
    const err = new ForbiddenError();
    expect(err).toBeInstanceOf(AuthError);
    expect(err.name).toBe('ForbiddenError');
  });

  it('InvalidCredentialsError should have default message', () => {
    const err = new InvalidCredentialsError();
    expect(err.message).toBe('Invalid email or password');
  });

  it('EmailAlreadyExistsError should have default message', () => {
    const err = new EmailAlreadyExistsError();
    expect(err.message).toBe('Email already registered');
  });

  it('TwoFactorRequiredError should be an AuthError', () => {
    const err = new TwoFactorRequiredError();
    expect(err).toBeInstanceOf(AuthError);
    expect(err.name).toBe('TwoFactorRequiredError');
  });

  it('ProviderError should be an AuthError', () => {
    const err = new ProviderError('OAuth failed');
    expect(err).toBeInstanceOf(AuthError);
    expect(err.message).toBe('OAuth failed');
  });
});
