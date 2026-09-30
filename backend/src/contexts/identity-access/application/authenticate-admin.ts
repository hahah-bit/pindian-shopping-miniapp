import { ApplicationError, type Clock } from '../../../shared/kernel';
import type { AdminTokenService, AdminRepository, SessionRepository } from './ports';
import type { Admin } from '../domain/admin';

export interface AuthenticatedAdmin {
  sessionId: string;
  adminId: string;
  username: string;
  displayName: string;
  role: Admin['state']['role'];
  permissions: string[];
}

export class AuthenticateAdmin {
  constructor(private readonly deps: { admins: AdminRepository; sessions: SessionRepository; tokens: AdminTokenService; clock: Clock }) {}

  async execute(token: string | undefined): Promise<AuthenticatedAdmin> {
    if (!token) throw new ApplicationError('UNAUTHENTICATED', '未提供访问凭证');
    const session = await this.deps.sessions.findByTokenHash(this.deps.tokens.hash(token));
    const now = this.deps.clock.now();
    if (!session || !session.isActive(now)) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    const admin = await this.deps.admins.findById(session.state.adminId);
    if (!admin || !admin.isActive) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    return {
      sessionId: session.state.sessionId,
      adminId: admin.state.adminId,
      username: admin.state.username,
      displayName: admin.state.displayName,
      role: admin.state.role,
      permissions: admin.permissions
    };
  }
}
