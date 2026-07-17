/**
 * Main Auth class — orchestrates all auth functionality.
 */

import { eq } from '@mountsqli/core';
import { createHash, createCipheriv, createDecipheriv, randomBytes, createHmac, randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './password.js';
import {
  createSession as createSessionFn,
  validateSession as validateSessionFn,
  revokeSession as revokeSessionFn,
  revokeAllSessions as revokeAllSessionsFn,
} from './session-manager.js';
import { generateSecret, generateCode, verifyCode, generateURI } from './totp.js';
import {
  getAuthorizationUrl,
  exchangeCode,
  getUserInfo,
  generateState,
} from './oauth.js';
import {
  createRole as createRoleFn,
  deleteRole as deleteRoleFn,
  getRoleByName,
  assignRole as assignRoleFn,
  removeRole as removeRoleFn,
  getUserRoles as getUserRolesFn,
  hasRole as hasRoleFn,
  hasPermission as hasPermissionFn,
} from './rbac.js';
import { ConsoleEmailAdapter, sendVerificationEmail, sendPasswordResetEmail } from './email.js';
import { InMemoryRateLimiter, type RateLimiter } from './rate-limiter.js';
import type { EmailAdapter } from './email.js';
import {
  UnauthorizedError,
  InvalidCredentialsError,
  EmailAlreadyExistsError,
  UserNotFoundError,
  TwoFactorRequiredError,
  TwoFactorInvalidError,
  ProviderError,
} from '../errors.js';
import type {
  AuthConfig,
  User,
  AuthResult,
  SessionData,
  MiddlewareOptions,
  AuthMiddlewareResult,
  CredentialsProvider,
  OAuthProvider,
  Role,
  CallbacksConfig,
} from '../types.js';

// ---------------------------------------------------------------------------
// Token encryption helpers
// ---------------------------------------------------------------------------

async function encryptToken(token: string, secret: string): Promise<string> {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function decryptToken(encrypted: string, secret: string): Promise<string> {
  const key = createHash('sha256').update(secret).digest();
  const [ivHex, tagHex, dataHex] = encrypted.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex!, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------------
// Auth class
// ---------------------------------------------------------------------------

export class Auth {
  private db: any;
  private secret: string;
  private sessionConfig: { strategy: 'jwt' | 'database'; maxAge: number };
  private callbacks?: CallbacksConfig;
  private rateLimiter: RateLimiter;
  private emailAdapter: EmailAdapter;
  private providers: any[];

  // Table references
  private usersTable: any;
  private sessionsTable: any;
  private accountsTable: any;
  private verificationTable: any;
  private rolesTable: any;
  private userRolesTable: any;

  constructor(config: AuthConfig) {
    this.db = config.db;
    this.secret = config.secret;
    this.sessionConfig = {
      strategy: config.session?.strategy ?? 'jwt',
      maxAge: config.session?.maxAge ?? 30 * 24 * 60 * 60,
    };
    this.callbacks = config.callbacks;
    this.rateLimiter = new InMemoryRateLimiter({ maxRequests: 5, windowMs: 60000 });
    this.emailAdapter = new ConsoleEmailAdapter();
    this.providers = config.providers ?? [];

    // Table references — prefer explicit config.tables, else auto-discover from db.tables
    const explicitTables = (config as any).tables ?? {};
    const dbTables: any[] = (this.db as any).tables ?? [];
    const findTable = (name: string, fallback: any) =>
      explicitTables[fallback] ?? dbTables.find((t: any) => t?.__name === name);
    this.usersTable = findTable('auth_users', 'users');
    this.sessionsTable = findTable('auth_sessions', 'sessions');
    this.accountsTable = findTable('auth_accounts', 'accounts');
    this.verificationTable = findTable('auth_verification_tokens', 'verification');
    this.rolesTable = findTable('auth_roles', 'roles');
    this.userRolesTable = findTable('auth_user_roles', 'userRoles');
  }

  // ---------------------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------------------

  async register(data: { email: string; password: string; name?: string }): Promise<AuthResult> {
    // Validate password
    const passwordValidation = this.isValidPassword(data.password);
    if (!passwordValidation.valid) {
      throw new InvalidCredentialsError(passwordValidation.errors.join('. '));
    }

    // Check if user already exists
    const existing = await this.db.query(this.usersTable).where('email', '=', data.email).findOne();
    if (existing) {
      throw new EmailAlreadyExistsError();
    }

    // Hash password
    const hashedPassword = await hashPassword(data.password);

    // Create user
    const { rows: [user] } = await this.db.query(this.usersTable).returning().insert({
      id: randomUUID(),
      email: data.email,
      password: hashedPassword,
      name: data.name ?? null,
    });

    const sanitizedUser = this.sanitizeUser(user);

    // Create session
    const result = await createSessionFn(
      {
        db: this.db,
        secret: this.secret,
        strategy: this.sessionConfig.strategy,
        maxAge: this.sessionConfig.maxAge,
        sessionsTable: this.sessionsTable,
        usersTable: this.usersTable,
      },
      sanitizedUser,
    );

    // Call onRegister callback
    await this.callbacks?.onRegister?.(sanitizedUser);

    return result;
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(
    providerId: string,
    credentials: Record<string, string>,
  ): Promise<AuthResult> {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider) {
      throw new ProviderError(`Provider "${providerId}" not found`);
    }

    if (provider.type === 'credentials') {
      return this.loginWithCredentials(provider as CredentialsProvider, credentials);
    }

    throw new ProviderError(`Provider "${providerId}" is not a credentials provider`);
  }

  private async loginWithCredentials(
    provider: CredentialsProvider,
    credentials: Record<string, string>,
  ): Promise<AuthResult> {
    const { email, password } = credentials;
    if (!email || !password) {
      throw new InvalidCredentialsError();
    }

    // Rate limit by email
    const rateLimitResult = await this.rateLimiter.check(`login:${email}`);
    if (!rateLimitResult.allowed) {
      throw new UnauthorizedError('Too many login attempts. Please try again later.');
    }

    // Find user
    const user = await this.db.query(this.usersTable).where('email', '=', email).findOne();
    if (!user || !user.password) {
      throw new InvalidCredentialsError();
    }

    // Verify password
    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      throw new InvalidCredentialsError();
    }

    // Check 2FA
    if (user.twoFactorEnabled) {
      const code = credentials.totp;
      if (!code) {
        throw new TwoFactorRequiredError();
      }

      if (!user.twoFactorSecret || !verifyCode(user.twoFactorSecret, code)) {
        throw new TwoFactorInvalidError();
      }
    }

    const sanitizedUser = this.sanitizeUser(user);

    // Create session
    const result = await createSessionFn(
      {
        db: this.db,
        secret: this.secret,
        strategy: this.sessionConfig.strategy,
        maxAge: this.sessionConfig.maxAge,
        sessionsTable: this.sessionsTable,
        usersTable: this.usersTable,
      },
      sanitizedUser,
    );

    // Call onLogin callback
    await this.callbacks?.onLogin?.(sanitizedUser);

    return result;
  }

  // ---------------------------------------------------------------------------
  // OAuth
  // ---------------------------------------------------------------------------

  async signIn(providerId: string): Promise<string> {
    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider || provider.type !== 'oauth') {
      throw new ProviderError(`OAuth provider "${providerId}" not found`);
    }

    const state = generateState();

    // Store state for CSRF validation (expires in 10 minutes)
    await this.db.query(this.verificationTable).insert({
      identifier: `state:${state}`,
      token: state,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    return getAuthorizationUrl(provider as OAuthProvider, state);
  }

  async handleCallback(
    providerId: string,
    params: { code?: string; state?: string; error?: string },
  ): Promise<AuthResult> {
    if (params.error) {
      throw new ProviderError(`OAuth error: ${params.error}`);
    }

    if (!params.code) {
      throw new ProviderError('Missing authorization code');
    }

    // Validate OAuth state (CSRF protection)
    if (params.state) {
      const stored = await this.db.query(this.verificationTable)
        .where('identifier', '=', `state:${params.state}`)
        .findOne();

      if (!stored || stored.expiresAt < new Date()) {
        throw new ProviderError('Invalid or expired OAuth state');
      }

      // Delete used state
      await this.db.query(this.verificationTable)
        .where('identifier', '=', `state:${params.state}`)
        .delete();
    }

    const provider = this.providers.find((p) => p.id === providerId);
    if (!provider || provider.type !== 'oauth') {
      throw new ProviderError(`OAuth provider "${providerId}" not found`);
    }

    const oauthProvider = provider as OAuthProvider;

    // Exchange code for tokens
    const tokenResponse = await exchangeCode(oauthProvider, params.code);

    // Get user info
    const userInfo = await getUserInfo(oauthProvider, tokenResponse.access_token);

    // Check if email is verified on OAuth provider
    if (!userInfo.emailVerified) {
      throw new ProviderError('Email not verified on OAuth provider');
    }

    // Find or create user
    let user = await this.db.query(this.usersTable)
      .where('email', '=', userInfo.email)
      .findOne();

    if (!user) {
      // Create new user
      const { rows: [newUser] } = await this.db.query(this.usersTable)
        .returning()
        .insert({
          id: randomUUID(),
          email: userInfo.email,
          name: userInfo.name ?? null,
          image: userInfo.image ?? null,
          emailVerified: new Date(),
        });

      user = newUser;

      // Store OAuth account with encrypted tokens
      const encryptedAccessToken = await encryptToken(tokenResponse.access_token, this.secret);
      const encryptedRefreshToken = tokenResponse.refresh_token
        ? await encryptToken(tokenResponse.refresh_token, this.secret)
        : null;

      await this.db.query(this.accountsTable).insert({
        userId: user.id,
        provider: providerId,
        providerAccountId: userInfo.id,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
      });

      await this.callbacks?.onRegister?.(this.sanitizeUser(user));
    } else {
      // Update existing account
      const existingAccount = await this.db.query(this.accountsTable)
        .where('userId', '=', user.id)
        .where('provider', '=', providerId)
        .findOne();

      if (existingAccount) {
        const encryptedAccessToken = await encryptToken(tokenResponse.access_token, this.secret);
        const encryptedRefreshToken = tokenResponse.refresh_token
          ? await encryptToken(tokenResponse.refresh_token, this.secret)
          : null;

        await this.db.query(this.accountsTable)
          .where('id', '=', existingAccount.id)
          .update({
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
          });
      } else {
        const encryptedAccessToken = await encryptToken(tokenResponse.access_token, this.secret);
        const encryptedRefreshToken = tokenResponse.refresh_token
          ? await encryptToken(tokenResponse.refresh_token, this.secret)
          : null;

        await this.db.query(this.accountsTable).insert({
          userId: user.id,
          provider: providerId,
          providerAccountId: userInfo.id,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
        });
      }
    }

    const sanitizedUser = this.sanitizeUser(user);

    const result = await createSessionFn(
      {
        db: this.db,
        secret: this.secret,
        strategy: this.sessionConfig.strategy,
        maxAge: this.sessionConfig.maxAge,
        sessionsTable: this.sessionsTable,
        usersTable: this.usersTable,
      },
      sanitizedUser,
    );

    await this.callbacks?.onLogin?.(sanitizedUser);

    return result;
  }

  // ---------------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------------

  async getSession(request: { headers?: Record<string, string | undefined> }): Promise<SessionData | null> {
    const token = this.extractToken(request);
    if (!token) return null;

    return validateSessionFn(
      {
        db: this.db,
        secret: this.secret,
        strategy: this.sessionConfig.strategy,
        maxAge: this.sessionConfig.maxAge,
        sessionsTable: this.sessionsTable,
        usersTable: this.usersTable,
      },
      token,
    );
  }

  async logout(token: string): Promise<void> {
    const session = await validateSessionFn(
      {
        db: this.db,
        secret: this.secret,
        strategy: this.sessionConfig.strategy,
        maxAge: this.sessionConfig.maxAge,
        sessionsTable: this.sessionsTable,
        usersTable: this.usersTable,
      },
      token,
    );

    if (session) {
      await this.callbacks?.onLogout?.(session);
    }

    await revokeSessionFn(
      {
        db: this.db,
        secret: this.secret,
        strategy: this.sessionConfig.strategy,
        maxAge: this.sessionConfig.maxAge,
        sessionsTable: this.sessionsTable,
        usersTable: this.usersTable,
      },
      token,
    );
  }

  // ---------------------------------------------------------------------------
  // 2FA
  // ---------------------------------------------------------------------------

  twoFactor = {
    generate: async (userId: string) => {
      const secret = generateSecret();
      const otpauthUrl = generateURI(secret, userId, 'MountSQLi');

      await this.db.query(this.usersTable)
        .where('id', '=', userId)
        .update({ twoFactorSecret: secret });

      return { secret, otpauthUrl };
    },

    enable: async (userId: string, code: string) => {
      const user = await this.db.query(this.usersTable)
        .where('id', '=', userId)
        .findOne();

      if (!user?.twoFactorSecret) {
        throw new UserNotFoundError();
      }

      if (!verifyCode(user.twoFactorSecret, code)) {
        throw new TwoFactorInvalidError();
      }

      await this.db.query(this.usersTable)
        .where('id', '=', userId)
        .update({ twoFactorEnabled: true });
    },

    disable: async (userId: string) => {
      await this.db.query(this.usersTable)
        .where('id', '=', userId)
        .update({ twoFactorEnabled: false, twoFactorSecret: null });
    },

    verify: (secret: string, code: string): boolean => {
      return verifyCode(secret, code);
    },
  };

  // ---------------------------------------------------------------------------
  // Password Reset
  // ---------------------------------------------------------------------------

  passwordReset = {
    create: async (email: string): Promise<string> => {
      const user = await this.db.query(this.usersTable)
        .where('email', '=', email)
        .findOne();

      if (!user) {
        return 'If an account exists, a reset email has been sent.';
      }

      const token = generateSecret(32);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await this.db.query(this.verificationTable).insert({
        identifier: email,
        token,
        expiresAt,
      });

      await sendPasswordResetEmail(this.emailAdapter, email, token);

      return 'If an account exists, a reset email has been sent.';
    },

    verify: async (token: string, newPassword: string): Promise<void> => {
      const verification = await this.db.query(this.verificationTable)
        .where('token', '=', token)
        .findOne();

      if (!verification || verification.expiresAt < new Date()) {
        throw new UnauthorizedError('Invalid or expired reset token');
      }

      const hashedPassword = await hashPassword(newPassword);

      await this.db.query(this.usersTable)
        .where('email', '=', verification.identifier)
        .update({ password: hashedPassword, updatedAt: new Date() });

      // Delete the token
      await this.db.query(this.verificationTable)
        .where('token', '=', token)
        .delete();

      // Revoke all sessions
      const user = await this.db.query(this.usersTable)
        .where('email', '=', verification.identifier)
        .findOne();

      await revokeAllSessionsFn(
        {
          db: this.db,
          secret: this.secret,
          strategy: this.sessionConfig.strategy,
          maxAge: this.sessionConfig.maxAge,
          sessionsTable: this.sessionsTable,
          usersTable: this.usersTable,
        },
        user?.id ?? '',
      );
    },
  };

  // ---------------------------------------------------------------------------
  // Email Verification
  // ---------------------------------------------------------------------------

  emailVerification = {
    create: async (userId: string): Promise<string> => {
      const user = await this.db.query(this.usersTable)
        .where('id', '=', userId)
        .findOne();

      if (!user) throw new UserNotFoundError();

      const token = generateSecret(32);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await this.db.query(this.verificationTable).insert({
        identifier: user.email,
        token,
        expiresAt,
      });

      await sendVerificationEmail(this.emailAdapter, user.email, token);

      return token;
    },

    verify: async (token: string): Promise<void> => {
      const verification = await this.db.query(this.verificationTable)
        .where('token', '=', token)
        .findOne();

      if (!verification || verification.expiresAt < new Date()) {
        throw new UnauthorizedError('Invalid or expired verification token');
      }

      await this.db.query(this.usersTable)
        .where('email', '=', verification.identifier)
        .update({ emailVerified: new Date() });

      await this.db.query(this.verificationTable)
        .where('token', '=', token)
        .delete();
    },
  };

  // ---------------------------------------------------------------------------
  // RBAC
  // ---------------------------------------------------------------------------

  rbac = {
    createRole: (data: { name: string; permissions: string[] }) =>
      createRoleFn({ db: this.db, rolesTable: this.rolesTable, userRolesTable: this.userRolesTable }, data),

    deleteRole: (roleId: string) =>
      deleteRoleFn({ db: this.db, rolesTable: this.rolesTable, userRolesTable: this.userRolesTable }, roleId),

    assignRole: (userId: string, roleName: string) =>
      assignRoleFn({ db: this.db, rolesTable: this.rolesTable, userRolesTable: this.userRolesTable }, userId, roleName),

    removeRole: (userId: string, roleName: string) =>
      removeRoleFn({ db: this.db, rolesTable: this.rolesTable, userRolesTable: this.userRolesTable }, userId, roleName),

    getUserRoles: (userId: string): Promise<Role[]> =>
      getUserRolesFn({ db: this.db, rolesTable: this.rolesTable, userRolesTable: this.userRolesTable }, userId),

    hasRole: (userId: string, roleName: string): Promise<boolean> =>
      hasRoleFn({ db: this.db, rolesTable: this.rolesTable, userRolesTable: this.userRolesTable }, userId, roleName),

    authorize: (userId: string, permission: string): Promise<boolean> =>
      hasPermissionFn({ db: this.db, rolesTable: this.rolesTable, userRolesTable: this.userRolesTable }, userId, permission),
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
  }

  private isValidPassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (password.length > 128) errors.push('Password must be at most 128 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain a number');
    return { valid: errors.length === 0, errors };
  }

  /** Generate a CSRF token for a session */
  generateCsrfToken(sessionToken: string): string {
    return createHmac('sha256', this.secret).update(sessionToken).digest('hex');
  }

  /** Validate a CSRF token */
  validateCsrfToken(sessionToken: string, csrfToken: string): boolean {
    const expected = this.generateCsrfToken(sessionToken);
    const expectedBuf = Buffer.from(expected);
    const inputBuf = Buffer.from(csrfToken);
    if (expectedBuf.length !== inputBuf.length) return false;
    const { timingSafeEqual } = require('node:crypto');
    return timingSafeEqual(expectedBuf, inputBuf);
  }

  private extractToken(request: { headers?: Record<string, string | undefined> }): string | null {
    const authHeader = request.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    // Also check cookie
    const cookieHeader = request.headers?.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/auth-token=([^;]+)/);
      if (match) return match[1] ?? null;
    }

    return null;
  }

  private sanitizeUser(user: any): User {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      image: user.image,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
