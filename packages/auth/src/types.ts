/**
 * Auth type definitions.
 */

import type { Db } from '@mountsqli/core';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AuthConfig {
  /** Database instance (MountSQLi Database) */
  db: Db<any>;
  /** Secret key for JWT signing */
  secret: string;
  /** Auth providers */
  providers: AuthProvider[];
  /** Session configuration */
  session?: SessionConfig;
  /** Custom pages */
  pages?: PagesConfig;
  /** Lifecycle callbacks */
  callbacks?: CallbacksConfig;
}

export interface SessionConfig {
  strategy: 'jwt' | 'database';
  maxAge: number; // seconds, default 30 days
}

export interface PagesConfig {
  signIn?: string;
  signUp?: string;
  error?: string;
  verifyRequest?: string;
}

export interface CallbacksConfig {
  onRegister?: (user: User) => Promise<void> | void;
  onLogin?: (user: User) => Promise<void> | void;
  onLogout?: (session: SessionData) => Promise<void> | void;
  onSession?: (session: SessionData) => Promise<SessionData | null> | SessionData | null;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  email: string;
  emailVerified: Date | null;
  name: string | null;
  image: string | null;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  password?: string;
  name?: string;
  image?: string;
  emailVerified?: Date;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface SessionData {
  user: User;
  expiresAt: Date;
}

export interface AuthResult {
  user: User;
  session: SessionData;
  token: string;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export interface AuthProvider {
  id: string;
  name: string;
  type: 'credentials' | 'oauth' | 'email';
}

export interface CredentialsProvider extends AuthProvider {
  type: 'credentials';
  authorize: (credentials: Record<string, string>, req?: any) => Promise<User | null>;
}

export interface OAuthProvider extends AuthProvider {
  type: 'oauth';
  clientId: string;
  clientSecret: string;
  scope?: string[];
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
}

export interface EmailProvider extends AuthProvider {
  type: 'email';
  sendVerificationEmail?: (email: string, token: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Roles / RBAC
// ---------------------------------------------------------------------------

export interface Role {
  id: string;
  name: string;
  permissions: string[];
  createdAt: Date;
}

export interface UserRole {
  userId: string;
  roleId: string;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export interface MiddlewareOptions {
  required?: boolean;
  requiredRole?: string;
  requiredPermission?: string;
}

export interface AuthMiddlewareResult {
  user: User | null;
  session: SessionData | null;
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

export interface JWTPayload {
  sub: string; // user ID
  email: string;
  name?: string;
  image?: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// OAuth Callback
// ---------------------------------------------------------------------------

export interface OAuthCallbackParams {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export interface OAuthUserInfo {
  id: string;
  email: string;
  name?: string;
  image?: string;
  emailVerified?: boolean;
}
