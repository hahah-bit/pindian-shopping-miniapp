import { ApplicationError } from '../../../../shared/kernel';

export type AddressRole = 'shipping';

export interface AddressState {
  addressId: string;
  userId: string;
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const ADDRESS_LIMIT_PER_USER = 20;
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

function trimmed(value: unknown, max: number, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 1 || text.length > max) throw new ApplicationError('VALIDATION_FAILED', `${label}须为 1-${max} 个字符`);
  return text;
}

/** 收货地址聚合根：归属用户；删除为物理删除（未来订单保存不可变快照，交易阶段实现）。 */
export class Address {
  private constructor(readonly state: AddressState) {}

  static create(input: { addressId?: string; userId: unknown; receiverName: unknown; phone: unknown; province: unknown; city: unknown; district: unknown; detail: unknown; isDefault?: boolean; now: Date }): Address {
    const userId = typeof input.userId === 'string' && input.userId ? input.userId : '';
    if (!userId) throw new ApplicationError('VALIDATION_FAILED', '地址必须归属用户');
    return new Address({
      addressId: input.addressId ?? crypto.randomUUID(),
      userId,
      receiverName: trimmed(input.receiverName, 20, '收货人姓名'),
      phone: validatePhone(input.phone),
      province: trimmed(input.province, 20, '省份'),
      city: trimmed(input.city, 20, '城市'),
      district: trimmed(input.district, 20, '区县'),
      detail: validateDetail(input.detail),
      isDefault: input.isDefault === true,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  static rehydrate(state: AddressState): Address {
    return new Address({ ...state });
  }

  relocate(input: { receiverName: unknown; phone: unknown; province: unknown; city: unknown; district: unknown; detail: unknown }, now: Date): Address {
    return new Address({
      ...this.state,
      receiverName: trimmed(input.receiverName, 20, '收货人姓名'),
      phone: validatePhone(input.phone),
      province: trimmed(input.province, 20, '省份'),
      city: trimmed(input.city, 20, '城市'),
      district: trimmed(input.district, 20, '区县'),
      detail: validateDetail(input.detail),
      updatedAt: now
    });
  }

  withDefault(isDefault: boolean): Address {
    return new Address({ ...this.state, isDefault, updatedAt: this.state.updatedAt });
  }
}

export function validatePhone(input: unknown): string {
  const phone = typeof input === 'string' ? input.trim() : '';
  if (!PHONE_PATTERN.test(phone)) throw new ApplicationError('VALIDATION_FAILED', '手机号须为 11 位大陆手机号');
  return phone;
}

function validateDetail(input: unknown): string {
  const detail = typeof input === 'string' ? input.trim() : '';
  if (detail.length < 5 || detail.length > 120) throw new ApplicationError('VALIDATION_FAILED', '详细地址须为 5-120 个字符');
  return detail;
}
