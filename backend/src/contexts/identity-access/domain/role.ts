export type AdminRole = 'super_admin' | 'catalog_admin' | 'cs_agent' | 'cs_supervisor';

export type AdminPermission =
  | 'catalog:manage'
  | 'inventory:manage'
  | 'media:manage'
  | 'admin:manage'
  | 'user:manage'
  | 'order:manage'
  | 'agent:manage'
  | 'agent:supervise'
  | 'reporting:view'
  | 'reporting:view_cs'
  | 'audit:view'
  | 'notification:manage';

/**
 * 角色-权限（需求 §6.1：超级管理员=全部；商品管理员=商品/库存/图片，无订单履约）。
 * T009/D025：super_admin 独占 reporting:view、audit:view、notification:manage；
 * cs_supervisor 另有 reporting:view_cs（客服数据只读）；cs_agent/catalog_admin 不新增。
 */
export const ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  super_admin: ['catalog:manage', 'inventory:manage', 'media:manage', 'admin:manage', 'user:manage', 'order:manage', 'agent:manage', 'agent:supervise', 'reporting:view', 'reporting:view_cs', 'audit:view', 'notification:manage'],
  catalog_admin: ['catalog:manage', 'inventory:manage', 'media:manage'],
  cs_agent: ['agent:manage'],
  cs_supervisor: ['agent:manage', 'agent:supervise', 'reporting:view_cs']
};

export function permissionsOfRole(role: AdminRole): AdminPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function can(role: AdminRole, permission: AdminPermission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/** 角色中文名（权限矩阵展示用）。 */
export const ROLE_LABELS: Readonly<Record<AdminRole, string>> = {
  super_admin: '超级管理员',
  catalog_admin: '商品管理员',
  cs_agent: '客服人员',
  cs_supervisor: '客服主管'
};
