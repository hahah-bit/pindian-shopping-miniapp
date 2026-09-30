import { ApplicationError, SystemClock, type Clock } from '../../../../shared/kernel';
import { User, maskPhone, type UserState } from '../../domain/user/user';
import { WechatIdentity } from '../../domain/user/wechat-identity';
import { UserSession } from '../../domain/user/user-session';
import {
  WxCodeInvalidError,
  WxNotConfiguredError,
  WxUnavailableError,
  type WxPhonePort
} from './wx-ports';
import type { AuthenticatedUser, LoginWithWechatDeps, LoginWithWechatResult, MiniUserProfile, UserSessionRepository, UserRepository, UserTokenService, WechatIdentityRepository } from './user-ports';

export function toMiniUserProfile(user: User): MiniUserProfile {
  return {
    id: user.state.userId,
    nickname: user.state.nickname,
    hasPhone: user.state.phone !== null,
    phoneMasked: maskPhone(user.state.phone),
    phoneVerified: user.state.phoneVerifiedAt !== null,
    status: user.state.status,
    createdAt: user.state.createdAt
  };
}

function normalizeCode(input: unknown): string {
  const code = typeof input === 'string' ? input.trim() : '';
  if (!code || code.length > 256) throw new ApplicationError('VALIDATION_FAILED', '登录凭证缺失或格式无效');
  return code;
}

/**
 * 微信登录：code → code2Session（事务外）→ 身份查找/创建 + 会话签发在同一事务
 * （openid 唯一约束兜底并发首次登录，冲突回读并发赢家）。凭据未配置时显式失败，不伪造会话。
 */
export class LoginWithWechat {
  constructor(private readonly deps: LoginWithWechatDeps) {}

  async execute(input: { code: unknown }): Promise<LoginWithWechatResult> {
    const code = normalizeCode(input.code);
    const now = this.deps.clock.now();
    let sessionInfo: { openid: string; unionid?: string };
    try {
      sessionInfo = await this.deps.wxAuth.exchangeCodeForSession(code);
    } catch (error) {
      if (error instanceof WxNotConfiguredError) throw new ApplicationError('WECHAT_NOT_CONFIGURED', '微信登录暂未配置，请联系管理员');
      if (error instanceof WxCodeInvalidError) throw new ApplicationError('WECHAT_CODE_INVALID', '登录凭证无效，请重新登录');
      if (error instanceof WxUnavailableError) throw new ApplicationError('WECHAT_UNAVAILABLE', '微信服务暂不可用，请稍后重试');
      throw error;
    }

    let isNewUser = false;
    try {
      const outcome = await this.deps.runner.run(async () => {
        const existing = await this.deps.identities.findByOpenid(sessionInfo.openid);
        if (existing) {
          const user = await this.loadActiveUser(existing.state.userId);
          return this.finalize({ user, isNewUser: false, now });
        }
        const user = User.create({ now });
        await this.deps.users.save(user);
        await this.deps.identities.insert(WechatIdentity.bind({ openid: sessionInfo.openid, unionid: sessionInfo.unionid ?? null, userId: user.state.userId, now }));
        return this.finalize({ user, isNewUser: true, now });
      });
      isNewUser = outcome.isNewUser;
      try { await this.deps.sessions.deleteExpired(now); } catch { /* 清理失败不影响登录 */ }
      return outcome.result;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    // 并发首次登录：openid 唯一约束冲突 → 事务已回滚，回读并发赢家身份
    const winner = await this.deps.identities.findByOpenid(sessionInfo.openid);
    if (!winner) throw new ApplicationError('WECHAT_UNAVAILABLE', '登录处理冲突，请重试');
    const outcome = await this.deps.runner.run(async () => {
      const user = await this.loadActiveUser(winner.state.userId);
      return this.finalize({ user, isNewUser: false, now });
    });
    try { await this.deps.sessions.deleteExpired(now); } catch { /* 清理失败不影响登录 */ }
    return outcome.result;
  }

  private async loadActiveUser(userId: string): Promise<User> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw new ApplicationError('WECHAT_UNAVAILABLE', '用户身份数据异常，请联系管理员');
    if (!user.isActive) throw new ApplicationError('USER_DISABLED', '账号已被禁用，请联系管理员');
    return user;
  }

  private async finalize(input: { user: User; isNewUser: boolean; now: Date }): Promise<{ isNewUser: boolean; result: LoginWithWechatResult }> {
    const token = this.deps.tokens.generate();
    const session = UserSession.issue({ userId: input.user.state.userId, tokenHash: this.deps.tokens.hash(token), ttlMinutes: this.deps.sessionTtlMinutes, now: input.now });
    await this.deps.sessions.save(session);
    const loggedIn = input.user.recordLogin(input.now);
    await this.deps.users.save(loggedIn);
    return {
      isNewUser: input.isNewUser,
      result: { token, expiresAt: session.state.expiresAt, isNewUser: input.isNewUser, user: toMiniUserProfile(loggedIn) }
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export class AuthenticateUser {
  constructor(private readonly deps: { users: UserRepository; sessions: UserSessionRepository; tokens: UserTokenService; clock: Clock }) {}

  async execute(token: string | undefined): Promise<AuthenticatedUser> {
    if (!token) throw new ApplicationError('UNAUTHENTICATED', '未提供访问凭证');
    const session = await this.deps.sessions.findByTokenHash(this.deps.tokens.hash(token));
    const now = this.deps.clock.now();
    if (!session || !session.isActive(now)) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    const user = await this.deps.users.findById(session.state.userId);
    if (!user || !user.isActive) throw new ApplicationError('USER_DISABLED', '账号已被禁用');
    return {
      sessionId: session.state.sessionId,
      userId: user.state.userId,
      nickname: user.state.nickname,
      status: user.state.status,
      phone: user.state.phone,
      phoneVerifiedAt: user.state.phoneVerifiedAt,
      hasPhone: user.state.phone !== null,
      phoneMasked: maskPhone(user.state.phone),
      createdAt: user.state.createdAt,
      openid: null
    };
  }
}

/** 登出仅撤销当前会话（幂等）。 */
export class LogoutUser {
  constructor(private readonly deps: { sessions: UserSessionRepository; clock: Clock }) {}

  async execute(sessionId: string | undefined): Promise<{ revoked: true }> {
    if (sessionId) {
      const session = await this.deps.sessions.findBySessionId(sessionId);
      if (session) await this.deps.sessions.revoke(sessionId, this.deps.clock.now());
    }
    return { revoked: true };
  }
}

/** 手机号绑定：仅服务端验证事实驱动；失败不写任何用户字段。 */
export class BindPhone {
  private readonly clock: Clock;
  constructor(deps: { users: UserRepository; identities: WechatIdentityRepository; wxPhone: WxPhonePort; clock?: Clock }) {
    this.users = deps.users;
    this.identities = deps.identities;
    this.wxPhone = deps.wxPhone;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly users: UserRepository;
  private readonly identities: WechatIdentityRepository;
  private readonly wxPhone: WxPhonePort;

  async execute(input: { userId: unknown; code: unknown }): Promise<{ hasPhone: true; phoneMasked: string; phoneVerified: true }> {
    const code = normalizeCode(input.code);
    const userId = requireUserId(input.userId);
    const user = await this.depsById(userId);
    const identity = await this.identities.findByUserId(user.state.userId);
    const openid = identity?.state.openid ?? null;
    let phoneInfo;
    try {
      phoneInfo = await this.wxPhone.exchangePhoneNumberCode(code, openid);
    } catch (error) {
      if (error instanceof WxNotConfiguredError) throw new ApplicationError('WECHAT_NOT_CONFIGURED', '微信服务暂未配置，请联系管理员');
      if (error instanceof WxUnavailableError) throw new ApplicationError('WECHAT_UNAVAILABLE', '微信服务暂不可用，请稍后重试');
      throw error;
    }
    const bound = user.bindPhone(phoneInfo.purePhoneNumber, phoneInfo.countryCode, 'wechat_quick_verify', this.clock.now());
    await this.users.save(bound);
    return { hasPhone: true, phoneMasked: maskPhone(bound.state.phone)!, phoneVerified: true };
  }

  private async depsById(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    return user;
  }
}

/** 昵称修改。 */
export class UpdateProfile {
  private readonly clock: Clock;
  constructor(deps: { users: UserRepository; clock?: Clock }) {
    this.users = deps.users;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly users: UserRepository;

  async execute(input: { userId: unknown; nickname: unknown }): Promise<{ id: string; nickname: string }> {
    const userId = requireUserId(input.userId);
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    const renamed = user.rename(input.nickname);
    await this.users.save(renamed);
    return { id: renamed.state.userId, nickname: renamed.state.nickname };
  }
}

function requireUserId(input: unknown): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
  }
  return input;
}

export type { UserState };
