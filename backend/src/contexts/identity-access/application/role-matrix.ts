import { ROLE_LABELS, ROLE_PERMISSIONS, type AdminPermission, type AdminRole } from '../domain/role';

/** 角色-权限矩阵（T009/F039，D025）：静态映射，供后台「权限与审计」页展示。 */
export function roleMatrix(): { roles: Array<{ role: AdminRole; label: string; permissions: AdminPermission[] }> } {
  const roles = Object.keys(ROLE_PERMISSIONS) as AdminRole[];
  return {
    roles: roles.map((role) => ({ role, label: ROLE_LABELS[role], permissions: [...ROLE_PERMISSIONS[role]] }))
  };
}
