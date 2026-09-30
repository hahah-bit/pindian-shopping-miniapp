import { ApplicationError } from '../../../../shared/kernel';

const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface UserSessionState {
  sessionId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

/** 用户会话：绝对过期、可撤销；仅撤销当前会话（不做全设备踢出）。 */
export class UserSession {
  private constructor(readonly state: UserSessionState) {}

  static issue(input: { userId: string; tokenHash: string; ttlMinutes: number; now: Date; sessionId?: string }): UserSession {
    if (!TOKEN_HASH_PATTERN.test(input.tokenHash)) throw new ApplicationError('VALIDATION_FAILED', '会话凭证格式无效');
    if (!Number.isInteger(input.ttlMinutes) || input.ttlMinutes < 1) throw new ApplicationError('VALIDATION_FAILED', '会话有效期必须为正整数分钟');
    return new UserSession({
      sessionId: input.sessionId ?? crypto.randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: new Date(input.now.getTime() + input.ttlMinutes * 60_000),
      revokedAt: null,
      createdAt: input.now
    });
  }

  static rehydrate(state: UserSessionState): UserSession {
    return new UserSession({ ...state });
  }

  isActive(now: Date): boolean {
    return this.state.revokedAt === null && this.state.expiresAt.getTime() > now.getTime();
  }

  revoke(now: Date): UserSession {
    if (this.state.revokedAt !== null) return this;
    return new UserSession({ ...this.state, revokedAt: now });
  }
}
