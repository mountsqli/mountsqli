/**
 * Auth-specific error classes.
 */

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor(message = 'Invalid email or password') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class UserNotFoundError extends AuthError {
  constructor(message = 'User not found') {
    super(message);
    this.name = 'UserNotFoundError';
  }
}

export class EmailAlreadyExistsError extends AuthError {
  constructor(message = 'Email already registered') {
    super(message);
    this.name = 'EmailAlreadyExistsError';
  }
}

export class InvalidTokenError extends AuthError {
  constructor(message = 'Invalid or expired token') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

export class TwoFactorRequiredError extends AuthError {
  constructor(message = 'Two-factor authentication required') {
    super(message);
    this.name = 'TwoFactorRequiredError';
  }
}

export class TwoFactorInvalidError extends AuthError {
  constructor(message = 'Invalid two-factor code') {
    super(message);
    this.name = 'TwoFactorInvalidError';
  }
}

export class SessionExpiredError extends AuthError {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ProviderError extends AuthError {
  constructor(message = 'Authentication provider error') {
    super(message);
    this.name = 'ProviderError';
  }
}
