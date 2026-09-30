import { ApplicationError } from '../../../shared/kernel';

const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface AdminSessionState {
  sessionId: string;
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface IssueSessionInput {
  adminId: string;
  tokenHash: string;
  ttlMinutes: number;
  now: Date;
  sessionId?: string;
}

/** 管理员会话：绝对过期、可撤销；token 原文不进入领域与存储。 */
export class AdminSession {
  private constructor(readonly state: AdminSessionState) {}

  static issue(input: IssueSessionInput): AdminSession {
    if (!TOKEN_HASH_PATTERN.test(input.tokenHash)) {
      throw new ApplicationError('VALIDATION_FAILED', '会话凭证格式无效');
    }
    if (!Number.isInteger(input.ttlMinutes) || input.ttlMinutes < 1) {
      throw new ApplicationError('VALIDATION_FAILED', '会话有效期必须为正整数分钟');
    }
    return new AdminSession({
      sessionId: input.sessionId ?? crypto.randomUUID(),
      adminId: input.adminId,
      tokenHash: input.tokenHash,
      expiresAt: new Date(input.now.getTime() + input.ttlMinutes * 60_000),
      revokedAt: null,
      createdAt: input.now
    });
  }

  static rehydrate(state: AdminSessionState): AdminSession {
    return new AdminSession({ ...state });
  }

  isActive(now: Date): boolean {
    return this.state.revokedAt === null && this.state.expiresAt.getTime() > now.getTime();
  }

  revoke(now: Date): AdminSession {
    if (this.state.revokedAt !== null) return this;
    return new AdminSession({ ...this.state, revokedAt: now });
  }
}
