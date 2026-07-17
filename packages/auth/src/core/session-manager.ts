/**
 * Session lifecycle management.
 */

import { eq, and, gt } from '@mountsqli/core';
import { createToken, verifyToken } from './jwt.js';
import type { User, Session, SessionData, AuthResult } from '../types.js';

export interface SessionManagerConfig {
  db: any;
  secret: string;
  strategy: 'jwt' | 'database';
  maxAge: number; // seconds
  sessionsTable: any;
  usersTable: any;
}

/**
 * Create a session for a user.
 */
export async function createSession(
  config: SessionManagerConfig,
  user: User,
  options?: { ipAddress?: string; userAgent?: string },
): Promise<AuthResult> {
  const expiresAt = new Date(Date.now() + config.maxAge * 1000);

  if (config.strategy === 'jwt') {
    const token = await createToken(
      {
        sub: user.id,
        email: user.email,
        name: user.name ?? undefined,
        image: user.image ?? undefined,
      },
      config.secret,
      { maxAge: config.maxAge },
    );

    return {
      user,
      session: { user, expiresAt },
      token,
    };
  }

  // Database session strategy
  const token = await createToken(
    {
      sub: user.id,
      email: user.email,
      name: user.name ?? undefined,
      image: user.image ?? undefined,
    },
    config.secret,
    { maxAge: config.maxAge },
  );

  const { rows: [session] } = await config.db
    .query(config.sessionsTable)
    .returning()
    .insert({
      userId: user.id,
      token,
      expiresAt,
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
    });

  return {
    user,
    session: { user, expiresAt },
    token,
  };
}

/**
 * Validate a session token and return session data.
 */
export async function validateSession(
  config: SessionManagerConfig,
  token: string,
): Promise<SessionData | null> {
  const payload = await verifyToken(token, config.secret);
  if (!payload) return null;

  if (config.strategy === 'jwt') {
    // For JWT strategy, we need to fetch the user
    const user = await config.db
      .query(config.usersTable)
      .where(eq('id', payload.sub))
      .findOne();

    if (!user) return null;

    return {
      user: sanitizeUser(user),
      expiresAt: new Date(payload.exp * 1000),
    };
  }

  // Database session strategy
  const session = await config.db
    .query(config.sessionsTable)
    .where(
      and(
        eq(config.sessionsTable.token, token),
        gt(config.sessionsTable.expiresAt, new Date()),
      ),
    )
    .findOne();

  if (!session) return null;

  const user = await config.db
    .query(config.usersTable)
    .where(eq('id', session.userId))
    .findOne();

  if (!user) return null;

  return {
    user: sanitizeUser(user),
    expiresAt: session.expiresAt,
  };
}

/**
 * Revoke a session.
 */
export async function revokeSession(
  config: SessionManagerConfig,
  token: string,
): Promise<void> {
  if (config.strategy === 'jwt') {
    // JWT can't be revoked — we rely on expiry
    return;
  }

  await config.db
    .query(config.sessionsTable)
    .where(eq('token', token))
    .delete();
}

/**
 * Revoke all sessions for a user.
 */
export async function revokeAllSessions(
  config: SessionManagerConfig,
  userId: string,
): Promise<void> {
  if (config.strategy === 'jwt') {
    return;
  }

  await config.db
    .query(config.sessionsTable)
    .where(eq('userId', userId))
    .delete();
}

/**
 * Remove sensitive fields from user object.
 */
function sanitizeUser(user: any): User {
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
