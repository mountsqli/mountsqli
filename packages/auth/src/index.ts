/**
 * @mountsqli/auth — Pre-built authentication system for MountSQLi.
 */

// Main entry
export { Auth } from './core/auth.js';
import { Auth } from './core/auth.js';
import type { AuthConfig } from './types.js';

/**
 * Create an Auth instance.
 */
export function createAuth(config: AuthConfig): Auth {
  return new Auth(config);
}

// Schema tables
export {
  authUsers,
  authSessions,
  authAccounts,
  authVerificationTokens,
  authRoles,
  authUserRoles,
} from './schema/index.js';

// Providers
export { credentials, type CredentialsProviderConfig } from './providers/credentials.js';
export { google, type GoogleProviderConfig } from './providers/google.js';
export { github, type GitHubProviderConfig } from './providers/github.js';

// Middleware
export {
  resolveAuth,
  expressMiddleware,
  requireAuth,
  nextjsMiddleware,
  nextjsApiAuth,
  fastifyPlugin,
  requireAuthFastify,
  honoMiddleware,
  requireAuthHono,
  type ExpressAuthMiddlewareOptions,
  type NextAuthMiddlewareOptions,
  type FastifyAuthMiddlewareOptions,
  type HonoAuthMiddlewareOptions,
} from './middleware/index.js';

// Password utilities
export { hashPassword, verifyPassword } from './core/password.js';

// JWT utilities
export { createToken, verifyToken, decodeToken } from './core/jwt.js';

// TOTP utilities
export { generateSecret, generateCode, verifyCode, generateURI } from './core/totp.js';

// RLS policy helpers (used by @mountsqli/storage and others)
export { compilePolicy } from './core/policy.js';
export type { Policy, PolicyContext } from './core/policy.js';

// Email
export { ConsoleEmailAdapter, sendVerificationEmail, sendPasswordResetEmail } from './core/email.js';
export type { EmailAdapter } from './core/email.js';

// Errors
export {
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

// Types
export type {
  AuthConfig,
  SessionConfig,
  PagesConfig,
  CallbacksConfig,
  User,
  CreateUserInput,
  Session,
  SessionData,
  AuthResult,
  AuthProvider,
  CredentialsProvider,
  OAuthProvider,
  EmailProvider,
  Role,
  UserRole,
  MiddlewareOptions,
  AuthMiddlewareResult,
  JWTPayload,
  OAuthCallbackParams,
  OAuthTokenResponse,
  OAuthUserInfo,
} from './types.js';
