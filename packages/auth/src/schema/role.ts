/**
 * Pre-built roles table for RBAC.
 */

import { defineTable, uuid, text, timestamp } from '@mountsqli/schema';

export const authRoles = defineTable('auth_roles', {
  id: uuid().pk() as any,
  name: text().notNull().unique() as any,
  permissions: text().notNull().default('[]') as any, // stored as JSON text
  createdAt: timestamp().notNull().defaultNow() as any,
});
