/**
 * Pre-built user_roles junction table for RBAC.
 */

import { defineTable, uuid } from '@mountsqli/schema';

export const authUserRoles = defineTable('auth_user_roles', {
  userId: uuid().notNull().references('auth_users', 'id', { onDelete: 'cascade' }) as any,
  roleId: uuid().notNull().references('auth_roles', 'id', { onDelete: 'cascade' }) as any,
});
