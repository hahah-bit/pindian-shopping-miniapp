import type { Clock } from '../../../shared/kernel';
import { Admin, validateInitialCredentials } from '../domain/admin';
import type { AdminRepository, PasswordHasher, SessionRepository } from './ports';

/**
 * 初始管理员创建/更新：幂等。
 * 已存在同名管理员 → 更新密码哈希、置 active 并撤销其全部会话。
 */
export class CreateOrUpdateInitialAdmin {
  constructor(private readonly deps: { admins: AdminRepository; sessions: SessionRepository; hasher: PasswordHasher; clock: Clock }) {}

  async execute(input: { username: string; password: string }): Promise<{ created: boolean; adminId: string }> {
    const credentials = validateInitialCredentials(input);
    const passwordHash = await this.deps.hasher.hash(credentials.password);
    const now = this.deps.clock.now();
    const existing = await this.deps.admins.findByUsername(credentials.username);
    if (existing) {
      const updated = existing.changePassword(passwordHash, now).activate(now);
      await this.deps.admins.save(updated);
      await this.deps.sessions.revokeAllForAdmin(updated.state.adminId, now);
      return { created: false, adminId: updated.state.adminId };
    }
    const admin = Admin.create({ username: credentials.username, displayName: credentials.username, passwordHash, now });
    await this.deps.admins.save(admin);
    return { created: true, adminId: admin.state.adminId };
  }
}
