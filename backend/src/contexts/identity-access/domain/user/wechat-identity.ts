import { ApplicationError } from '../../../../shared/kernel';

export interface WechatIdentityState {
  identityId: string;
  openid: string;
  unionid: string | null;
  userId: string;
  boundAt: Date;
}

/** 微信外部身份：openid 唯一（数据库唯一约束为并发首次登录的最终防线）。 */
export class WechatIdentity {
  private constructor(readonly state: WechatIdentityState) {}

  static bind(input: { openid: unknown; unionid?: string | null; userId: unknown; now: Date; identityId?: string }): WechatIdentity {
    const openid = typeof input.openid === 'string' ? input.openid.trim() : '';
    if (!openid || openid.length > 64) throw new ApplicationError('VALIDATION_FAILED', 'openid 无效');
    const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
    if (!userId) throw new ApplicationError('VALIDATION_FAILED', '微信身份必须关联用户');
    return new WechatIdentity({
      identityId: input.identityId ?? crypto.randomUUID(),
      openid,
      unionid: input.unionid ?? null,
      userId,
      boundAt: input.now
    });
  }

  static rehydrate(state: WechatIdentityState): WechatIdentity {
    return new WechatIdentity({ ...state });
  }
}
