export type AdminRole = 'super_admin' | 'catalog_admin' | 'cs_agent' | 'cs_supervisor';

export type AdminPermission =
  | 'catalog:manage'
  | 'inventory:manage'
  | 'media:manage'
  | 'admin:manage'
  | 'user:manage'
  | 'order:manage'
  | 'agent:manage'
  | 'agent:supervise';

/** 角色-权限（需求 §6.1：超级管理员=全部；商品管理员=商品/库存/图片，无订单履约）。 */
export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  super_admin: ['catalog:manage', 'inventory:manage', 'media:manage', 'admin:manage', 'user:manage', 'order:manage', 'agent:manage', 'agent:supervise'],
  catalog_admin: ['catalog:manage', 'inventory:manage', 'media:manage'],
  cs_agent: ['agent:manage'],
  cs_supervisor: ['agent:manage', 'agent:supervise']
};

export function permissionsOfRole(role: AdminRole): AdminPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function can(role: AdminRole, permission: AdminPermission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}
