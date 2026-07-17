/**
 * Pre-built OAuth accounts table for auth.
 */

import { defineTable, uuid, text, timestamp } from '@mountsqli/schema';

export const authAccounts = defineTable('auth_accounts', {
  id: uuid().pk() as any,
  userId: uuid().notNull().references('auth_users', 'id', { onDelete: 'cascade' }) as any,
  provider: text().notNull() as any,
  providerAccountId: text().notNull() as any,
  accessToken: text().nullable() as any,
  refreshToken: text().nullable() as any,
  expiresAt: timestamp().nullable() as any,
  createdAt: timestamp().notNull().defaultNow() as any,
});
