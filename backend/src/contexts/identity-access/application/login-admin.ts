import { ApplicationError, type Clock } from '../../../shared/kernel';
import { AdminSession } from '../domain/admin-session';
import type { LoginThrottle } from '../domain/login-throttle';
import type { Admin } from '../domain/admin';
import type { AdminTokenService, AdminRepository, SessionRepository, PasswordHasher } from './ports';

export interface LoginAdminDeps {
  admins: AdminRepository;
  sessions: SessionRepository;
  hasher: PasswordHasher;
  tokens: AdminTokenService;
  clock: Clock;
  sessionTtlMinutes: number;
  throttle: LoginThrottle;
}

export interface AdminProfileResult {
  id: string;
  username: string;
  displayName: string;
  role: Admin['state']['role'];
  permissions: string[];
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  admin: AdminProfileResult;
}

const GENERIC_FAILURE = '用户名或密码不正确';

export class LoginAdmin {
  constructor(private readonly deps: LoginAdminDeps) {}

  async execute(input: { username: string; password: string }): Promise<LoginResult> {
    const username = (input.username ?? '').trim();
    const password = input.password ?? '';
    if (!username || !password || username.length > 128 || password.length > 128) {
      throw new ApplicationError('UNAUTHENTICATED', GENERIC_FAILURE);
    }
    const now = this.deps.clock.now();
    const remaining = this.deps.throttle.lockedRemainingMs(username, now);
    if (remaining > 0) {
      const minutes = Math.max(1, Math.ceil(remaining / 60_000));
      throw new ApplicationError('RATE_LIMITED', `尝试次数过多，请约 ${minutes} 分钟后再试`);
    }

    const admin = await this.deps.admins.findByUsername(username.toLowerCase());
    const passwordOk = admin ? await this.deps.hasher.verify(password, admin.state.passwordHash) : false;
    // 未知用户也执行一次校验，避免通过响应时间区分用户是否存在。
    if (!admin) await this.deps.hasher.verify(password, 'scrypt$placeholder$verify');
    if (!admin || !passwordOk || !admin.isActive) {
      this.deps.throttle.recordFailure(username.toLowerCase(), now);
      throw new ApplicationError('UNAUTHENTICATED', GENERIC_FAILURE);
    }

    const token = this.deps.tokens.generate();
    const session = AdminSession.issue({
      adminId: admin.state.adminId,
      tokenHash: this.deps.tokens.hash(token),
      ttlMinutes: this.deps.sessionTtlMinutes,
      now
    });
    await this.deps.sessions.save(session);
    await this.deps.admins.save(admin.recordLogin(now));
    this.deps.throttle.reset(username.toLowerCase());
    try { await this.deps.sessions.deleteExpired(now); } catch { /* 清理失败不影响登录 */ }
    return {
      token,
      expiresAt: session.state.expiresAt,
      admin: {
        id: admin.state.adminId,
        username: admin.state.username,
        displayName: admin.state.displayName,
        role: admin.state.role,
        permissions: admin.permissions
      }
    };
  }
}
