import { ApplicationError } from '../../../shared/kernel';
import { permissionsOfRole, type AdminPermission, type AdminRole } from './role';

export const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export interface AdminState {
  adminId: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: AdminRole;
  status: 'active' | 'disabled';
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAdminInput {
  username: string;
  displayName: string;
  passwordHash: string;
  adminId?: string;
  now: Date;
}

/** 管理员聚合根。状态修改返回新实例，仓储按整体保存。 */
export class Admin {
  private constructor(readonly state: AdminState) {}

  static create(input: CreateAdminInput): Admin {
    const username = input.username.trim();
    if (!USERNAME_PATTERN.test(username)) {
      throw new ApplicationError('VALIDATION_FAILED', '用户名须为 3-32 位小写字母、数字、- 或 _');
    }
    const displayName = input.displayName.trim();
    if (displayName.length < 1 || displayName.length > 60) {
      throw new ApplicationError('VALIDATION_FAILED', '展示名须为 1-60 个字符');
    }
    if (!input.passwordHash) throw new ApplicationError('VALIDATION_FAILED', '密码哈希不能为空');
    return new Admin({
      adminId: input.adminId ?? crypto.randomUUID(),
      username,
      displayName,
      passwordHash: input.passwordHash,
      role: 'super_admin',
      status: 'active',
      lastLoginAt: null,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  static rehydrate(state: AdminState): Admin {
    return new Admin({ ...state });
  }

  get isActive(): boolean {
    return this.state.status === 'active';
  }

  get permissions(): AdminPermission[] {
    return permissionsOfRole(this.state.role);
  }

  recordLogin(now: Date): Admin {
    return new Admin({ ...this.state, lastLoginAt: now, updatedAt: now });
  }

  changePassword(passwordHash: string, now: Date): Admin {
    if (!passwordHash) throw new ApplicationError('VALIDATION_FAILED', '密码哈希不能为空');
    return new Admin({ ...this.state, passwordHash, updatedAt: now });
  }

  activate(now: Date): Admin {
    return new Admin({ ...this.state, status: 'active', updatedAt: now });
  }
}

export interface InitialCredentialInput {
  username: string;
  password: string;
}

/** 初始管理员凭据校验（创建脚本与用例共用）。 */
export function validateInitialCredentials(input: InitialCredentialInput): { username: string; password: string } {
  const username = input.username.trim();
  if (!USERNAME_PATTERN.test(username)) {
    throw new ApplicationError('VALIDATION_FAILED', 'ADMIN_INITIAL_USERNAME 须为 3-32 位小写字母、数字、- 或 _');
  }
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > MAX_PASSWORD_LENGTH) {
    throw new ApplicationError('VALIDATION_FAILED', `ADMIN_INITIAL_PASSWORD 长度须在 ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} 之间`);
  }
  return { username, password: input.password };
}
