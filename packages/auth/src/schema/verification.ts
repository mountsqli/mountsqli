/**
 * Pre-built verification tokens table for email verification and password reset.
 */

import { defineTable, uuid, text, timestamp } from '@mountsqli/schema';

export const authVerificationTokens = defineTable('auth_verification_tokens', {
  id: uuid().pk() as any,
  identifier: text().notNull() as any,
  token: text().notNull().unique() as any,
  expiresAt: timestamp().notNull() as any,
});
