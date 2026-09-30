import { ApplicationError, SystemClock, type Clock } from '../../../../shared/kernel';
import { maskPhone } from '../../domain/user/user';
import type { UserRepository, UserSessionRepository } from './user-ports';
import type { RecordOperation } from '../../../audit/application';

export interface AdminUserDeps {
  users: UserRepository;
  sessions: UserSessionRepository;
  audit: RecordOperation;
  clock?: Clock;
}

function toAdminView(user: { state: { userId: string; nickname: string; phone: string | null; status: 'active' | 'disabled'; createdAt: Date; lastLoginAt: Date | null } }) {
  return {
    id: user.state.userId,
    nickname: user.state.nickname,
    hasPhone: user.state.phone !== null,
    phoneMasked: maskPhone(user.state.phone),
    status: user.state.status,
    createdAt: user.state.createdAt,
    lastLoginAt: user.state.lastLoginAt ?? undefined
  };
}

export class ListAdminUsers {
  constructor(private readonly deps: AdminUserDeps) {}

  async execute(query: { keyword?: unknown; status?: unknown; page?: unknown; pageSize?: unknown }) {
    const keyword = typeof query.keyword === 'string' && query.keyword.trim() ? query.keyword.trim() : undefined;
    const status = typeof query.status === 'string' && ['active', 'disabled'].includes(query.status) ? query.status : undefined;
    const page = typeof query.page === 'number' && Number.isInteger(query.page) && query.page >= 1 ? query.page : 1;
    const pageSize = typeof query.pageSize === 'number' && Number.isInteger(query.pageSize) && query.pageSize >= 1 ? Math.min(query.pageSize, 50) : 10;
    const { items, total } = await this.deps.users.listUsers({ keyword, status, page, pageSize });
    return { items: items.map(toAdminView), page, pageSize, total };
  }
}

export class GetAdminUser {
  constructor(private readonly deps: AdminUserDeps) {}

  async execute(input: { userId: unknown }) {
    const user = await this.deps.users.findById(requireId(input.userId));
    if (!user) throw new ApplicationError('NOT_FOUND', '用户不存在');
    return toAdminView(user);
  }
}

/** 查看完整手机号：显式请求 + 强制审计（审计不含号码原文）。 */
export class RevealUserPhone {
  constructor(private readonly deps: AdminUserDeps) {}

  async execute(input: { userId: unknown; adminId: string | null; requestId?: string }): Promise<{ phone: string; countryCode: string }> {
    const user = await this.deps.users.findById(requireId(input.userId));
    if (!user || user.state.phone === null) throw new ApplicationError('NOT_FOUND', '用户不存在或未绑定手机号');
    await this.deps.audit.execute({
      adminId: input.adminId,
      action: 'user.phone_revealed',
      resourceType: 'user',
      resourceId: user.state.userId,
      detail: { hasPhone: true },
      requestId: input.requestId
    });
    return { phone: user.state.phone, countryCode: user.state.phoneCountryCode };
  }
}

export class DisableUser {
  private readonly clock: Clock;
  constructor(private readonly deps: AdminUserDeps) {
    this.clock = deps.clock ?? new SystemClock();
  }

  async execute(input: { userId: unknown; adminId: string | null; requestId?: string }) {
    const userId = requireId(input.userId);
    const changed = await this.deps.users.updateStatus(userId, 'disabled', this.clock.now());
    if (!changed) throw new ApplicationError('NOT_FOUND', '用户不存在');
    await this.deps.sessions.revokeAllForUser(userId, this.clock.now());
    await this.deps.audit.execute({
      adminId: input.adminId, action: 'user.disabled', resourceType: 'user', resourceId: userId, requestId: input.requestId
    });
    const user = await this.deps.users.findById(userId);
    return toAdminView(user!);
  }
}

export class EnableUser {
  private readonly clock: Clock;
  constructor(private readonly deps: AdminUserDeps) {
    this.clock = deps.clock ?? new SystemClock();
  }

  async execute(input: { userId: unknown; adminId: string | null; requestId?: string }) {
    const userId = requireId(input.userId);
    const changed = await this.deps.users.updateStatus(userId, 'active', this.clock.now());
    if (!changed) throw new ApplicationError('NOT_FOUND', '用户不存在');
    await this.deps.audit.execute({
      adminId: input.adminId, action: 'user.enabled', resourceType: 'user', resourceId: userId, requestId: input.requestId
    });
    const user = await this.deps.users.findById(userId);
    return toAdminView(user!);
  }
}

function requireId(input: unknown): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    throw new ApplicationError('NOT_FOUND', '用户不存在');
  }
  return input;
}
