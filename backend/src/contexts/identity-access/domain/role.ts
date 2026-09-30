export type AdminRole = 'super_admin';

export type AdminPermission =
  | 'catalog:manage'
  | 'inventory:manage'
  | 'media:manage'
  | 'admin:manage'
  | 'user:manage';

export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  super_admin: ['catalog:manage', 'inventory:manage', 'media:manage', 'admin:manage', 'user:manage']
};

export function permissionsOfRole(role: AdminRole): AdminPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function can(role: AdminRole, permission: AdminPermission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}
