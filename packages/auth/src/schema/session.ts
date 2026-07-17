/**
 * Pre-built sessions table for auth.
 */

import { defineTable, uuid, text, timestamp } from '@mountsqli/schema';

export const authSessions = defineTable('auth_sessions', {
  id: uuid().pk() as any,
  userId: uuid().notNull().references('auth_users', 'id', { onDelete: 'cascade' }) as any,
  token: text().notNull().unique() as any,
  expiresAt: timestamp().notNull() as any,
  ipAddress: text().nullable() as any,
  userAgent: text().nullable() as any,
});
