import { ApplicationError } from '../../../../shared/kernel';

export type UserStatus = 'active' | 'disabled';
export type PhoneSource = 'wechat_quick_verify';

export interface UserState {
  userId: string;
  nickname: string;
  phone: string | null;
  phoneCountryCode: string;
  phoneVerifiedAt: Date | null;
  phoneSource: PhoneSource | null;
  status: UserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export const USER_NICKNAME_MIN = 1;
export const USER_NICKNAME_MAX = 30;
export const DEFAULT_NICKNAME = '微信用户';

function validateNickname(nickname: unknown): string {
  const trimmed = typeof nickname === 'string' ? nickname.trim() : '';
  if (trimmed.length < USER_NICKNAME_MIN || trimmed.length > USER_NICKNAME_MAX) {
    throw new ApplicationError('VALIDATION_FAILED', `昵称须为 ${USER_NICKNAME_MIN}-${USER_NICKNAME_MAX} 个字符`);
  }
  return trimmed;
}

/** 用户聚合根：状态修改返回新实例。手机号只能经微信验证事实写入。 */
export class User {
  private constructor(readonly state: UserState) {}

  static create(input: { userId?: string; nickname?: unknown; phone?: unknown; now: Date }): User {
    if (input.phone !== undefined && input.phone !== null) {
      throw new ApplicationError('VALIDATION_FAILED', '用户创建时不能直接携带手机号（手机号必须经验证事实写入）');
    }
    return new User({
      userId: input.userId ?? crypto.randomUUID(),
      nickname: input.nickname === undefined ? DEFAULT_NICKNAME : validateNickname(input.nickname),
      phone: null,
      phoneCountryCode: '86',
      phoneVerifiedAt: null,
      phoneSource: null,
      status: 'active',
      createdAt: input.now,
      lastLoginAt: null
    });
  }

  static rehydrate(state: UserState): User {
    if (state.phone !== null && state.phoneVerifiedAt === null) {
      throw new ApplicationError('VALIDATION_FAILED', '用户数据损坏：手机号缺少验证事实');
    }
    return new User({ ...state });
  }

  get isActive(): boolean {
    return this.state.status === 'active';
  }

  recordLogin(now: Date): User {
    return new User({ ...this.state, lastLoginAt: now });
  }

  bindPhone(purePhoneNumber: string, countryCode: string, source: PhoneSource, verifiedAt: Date): User {
    if (!/^\d{5,20}$/.test(purePhoneNumber)) throw new ApplicationError('VALIDATION_FAILED', '手机号格式无效');
    if (source !== 'wechat_quick_verify') throw new ApplicationError('VALIDATION_FAILED', '手机号只能来自微信验证事实');
    return new User({ ...this.state, phone: purePhoneNumber, phoneCountryCode: countryCode || '86', phoneVerifiedAt: verifiedAt, phoneSource: source });
  }

  rename(nickname: unknown): User {
    return new User({ ...this.state, nickname: validateNickname(nickname) });
  }

  disable(now: Date): User {
    return new User({ ...this.state, status: 'disabled' });
  }

  enable(now: Date): User {
    return new User({ ...this.state, status: 'active' });
  }
}

/** 手机号展示脱敏：大陆 11 位掩码中间四位；其他仅保留尾 4 位。 */
export function maskPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  if (/^1[3-9]\d{9}$/.test(phone)) return `${phone.slice(0, 3)}****${phone.slice(7)}`;
  if (phone.length >= 4) return `****${phone.slice(-4)}`;
  return '****';
}
