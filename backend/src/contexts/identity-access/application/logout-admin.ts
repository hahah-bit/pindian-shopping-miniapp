import type { Clock } from '../../../shared/kernel';
import type { SessionRepository } from './ports';

/** 登出幂等：会话不存在或已撤销都返回成功，不泄露会话状态。 */
export class LogoutAdmin {
  constructor(private readonly deps: { sessions: SessionRepository; clock: Clock }) {}

  async execute(sessionId: string | undefined): Promise<{ revoked: true }> {
    if (sessionId) {
      const session = await this.deps.sessions.findById(sessionId);
      if (session) await this.deps.sessions.revoke(sessionId, this.deps.clock.now());
    }
    return { revoked: true };
  }
}
