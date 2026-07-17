/**
 * Pre-built users table for auth.
 */

import { defineTable, uuid, text, bool, timestamp } from '@mountsqli/schema';

export const authUsers = defineTable('auth_users', {
  id: uuid().pk() as any,
  email: text().notNull().unique() as any,
  emailVerified: timestamp().nullable() as any,
  password: text().nullable() as any,
  name: text().nullable() as any,
  image: text().nullable() as any,
  twoFactorEnabled: bool().notNull().default(false) as any,
  twoFactorSecret: text().nullable() as any,
  createdAt: timestamp().notNull().defaultNow() as any,
  updatedAt: timestamp().notNull().defaultNow() as any,
});
