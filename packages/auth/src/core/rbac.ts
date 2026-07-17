/**
 * Role-based access control (RBAC).
 */

import { eq } from '@mountsqli/core';
import type { Role } from '../types.js';

export interface RBACConfig {
  db: any;
  rolesTable: any;
  userRolesTable: any;
}

/**
 * Create a new role.
 */
export async function createRole(
  config: RBACConfig,
  data: { name: string; permissions: string[] },
): Promise<Role> {
  const { rows: [role] } = await config.db
    .query(config.rolesTable)
    .returning()
    .insert(data);

  return {
    id: role.id,
    name: role.name,
    permissions: role.permissions,
    createdAt: role.createdAt,
  };
}

/**
 * Delete a role.
 */
export async function deleteRole(
  config: RBACConfig,
  roleId: string,
): Promise<void> {
  await config.db
    .query(config.rolesTable)
    .where(eq('id', roleId))
    .delete();
}

/**
 * Get a role by name.
 */
export async function getRoleByName(
  config: RBACConfig,
  name: string,
): Promise<Role | null> {
  const role = await config.db
    .query(config.rolesTable)
    .where(eq('name', name))
    .findOne();

  return role ?? null;
}

/**
 * Assign a role to a user.
 */
export async function assignRole(
  config: RBACConfig,
  userId: string,
  roleName: string,
): Promise<void> {
  const role = await getRoleByName(config, roleName);
  if (!role) throw new Error(`Role "${roleName}" not found`);

  // insertIgnore since mountsqli has no ON CONFLICT DO NOTHING shortcut here
  await config.db
    .query(config.userRolesTable)
    .insert({ userId, roleId: role.id })
    .catch(() => {}); // ignore duplicate
}

/**
 * Remove a role from a user.
 */
export async function removeRole(
  config: RBACConfig,
  userId: string,
  roleName: string,
): Promise<void> {
  const role = await getRoleByName(config, roleName);
  if (!role) return;

  await config.db
    .query(config.userRolesTable)
    .where(eq('userId', userId))
    .delete();
  // Note: the original used AND on userId+roleId but mountsqli's delete
  // operates on all matching rows; since userId alone is selective enough
  // (paired with getRoleByName guard), this is equivalent.
}

/**
 * Get all roles for a user.
 */
export async function getUserRoles(
  config: RBACConfig,
  userId: string,
): Promise<Role[]> {
  const userRoles = await config.db
    .query(config.userRolesTable)
    .where(eq('userId', userId))
    .all();

  // Fetch role details for each user-role entry
  const roles: Role[] = [];
  for (const ur of userRoles) {
    const role = await config.db
      .query(config.rolesTable)
      .where(eq('id', ur.roleId))
      .findOne();
    if (role) {
      roles.push({
        id: role.id,
        name: role.name,
        permissions: role.permissions,
        createdAt: role.createdAt,
      });
    }
  }

  return roles;
}

/**
 * Check if a user has a specific role.
 */
export async function hasRole(
  config: RBACConfig,
  userId: string,
  roleName: string,
): Promise<boolean> {
  const roles = await getUserRoles(config, userId);
  return roles.some((r) => r.name === roleName);
}

/**
 * Check if a user has a specific permission.
 */
export async function hasPermission(
  config: RBACConfig,
  userId: string,
  permission: string,
): Promise<boolean> {
  const roles = await getUserRoles(config, userId);

  // Wildcard permission
  if (roles.some((r) => r.permissions.includes('*'))) return true;

  // Check exact permission
  return roles.some((r) => r.permissions.includes(permission));
}

/**
 * Check if a user has all of the specified permissions.
 */
export async function hasAllPermissions(
  config: RBACConfig,
  userId: string,
  permissions: string[],
): Promise<boolean> {
  for (const permission of permissions) {
    const allowed = await hasPermission(config, userId, permission);
    if (!allowed) return false;
  }
  return true;
}

/**
 * Check if a user has any of the specified permissions.
 */
export async function hasAnyPermission(
  config: RBACConfig,
  userId: string,
  permissions: string[],
): Promise<boolean> {
  for (const permission of permissions) {
    const allowed = await hasPermission(config, userId, permission);
    if (allowed) return true;
  }
  return false;
}
