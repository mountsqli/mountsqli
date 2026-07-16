// MountSQLI — RBAC (role-based access control).
// Roles aggregate permissions; a subject's effective permission set is the
// union of its roles' permissions. Permission checks are O(1) set lookups.

export type Permission = string; // e.g. "posts:read", "posts:write", "users:delete"

export interface Role {
  name: string;
  permissions: Permission[];
}

export class Rbac {
  private roles = new Map<string, Set<Permission>>();

  define(role: Role): this {
    this.roles.set(role.name, new Set(role.permissions));
    return this;
  }

  /** Assign additional permissions to an existing role. */
  grant(roleName: string, ...permissions: Permission[]): this {
    const set = this.roles.get(roleName) ?? new Set();
    permissions.forEach((p) => set.add(p));
    this.roles.set(roleName, set);
    return this;
  }

  /** Compute the effective permission set for a list of role names. */
  effective(roleNames: string[]): Set<Permission> {
    const out = new Set<Permission>();
    for (const r of roleNames) {
      const perms = this.roles.get(r);
      if (perms) perms.forEach((p) => out.add(p));
    }
    return out;
  }

  can(roleNames: string[], permission: Permission): boolean {
    return this.effective(roleNames).has(permission);
  }

  /** Wildcard support: "posts:*" grants all "posts:<x>". */
  canWildcard(roleNames: string[], permission: Permission): boolean {
    if (this.can(roleNames, permission)) return true;
    const [resource] = permission.split(":");
    return this.can(roleNames, `${resource}:*`);
  }
}
