import { ApplicationError } from '../../../shared/kernel';
import type { Quote } from './pricing';

export type OrderStatus = 'unpaid' | 'paid' | 'cancelled' | 'expired';

export interface OrderState {
  orderId: string;
  orderNo: string;
  userId: string;
  productId: string;
  groupId: string;
  units: number;
  status: OrderStatus;
  totalAmountFen: number;
  goodsAmountFen: number;
  serviceFeeFen: number;
  tailAdjustFen: number;
  isFinalOrder: boolean;
  originalPriceFen: number;
  unit: string;
  wholeQuantityText: string;
  referenceQuantityText: string;
  addressReceiverName: string;
  addressPhone: string;
  addressProvince: string;
  addressCity: string;
  addressDistrict: string;
  addressDetail: string;
  reservationExpiresAt: Date;
  idempotencyKey: string;
  paidAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class OrderNumber {
  /** PO + yyyyMMdd + 10 位随机数字（唯一约束兜底）。 */
  static generate(now: Date, randomDigits: () => string): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const random = randomDigits();
    if (!/^\d{10}$/.test(random)) throw new ApplicationError('VALIDATION_FAILED', '订单号随机段非法');
    return `PO${y}${m}${d}${random}`;
  }
}

export interface CreateOrderInput {
  orderId: string;
  orderNo: string;
  userId: string;
  productId: string;
  groupId: string;
  units: number;
  quote: Quote;
  snapshot: { originalPriceFen: number; unit: string; wholeQuantityText: string; referenceQuantityText: string };
  addressSnapshot: { receiverName: string; phone: string; province: string; city: string; district: string; detail: string };
  reservationExpiresAt: Date;
  idempotencyKey: string;
  now: Date;
}

/** 订单聚合根：unpaid 单向迁移；快照不可变；金额整数分自洽。 */
export class Order {
  private constructor(readonly state: OrderState) {}

  static create(input: CreateOrderInput): Order {
    const q = input.quote;
    if (q.totalAmountFen !== q.goodsAmountFen + q.serviceFeeFen) {
      throw new ApplicationError('VALIDATION_FAILED', '订单金额拆分不自洽');
    }
    if (q.tailAdjustFen !== 0 && !q.isFinalOrder) throw new ApplicationError('VALIDATION_FAILED', '非最后单不允许尾差调整');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
      throw new ApplicationError('VALIDATION_FAILED', '幂等键格式无效');
    }
    for (const field of [input.addressSnapshot.receiverName, input.addressSnapshot.phone, input.addressSnapshot.detail]) {
      if (typeof field !== 'string' || field.trim().length === 0) throw new ApplicationError('VALIDATION_FAILED', '地址快照不完整');
    }
    return new Order({
      orderId: input.orderId,
      orderNo: input.orderNo,
      userId: input.userId,
      productId: input.productId,
      groupId: input.groupId,
      units: input.units,
      status: 'unpaid',
      totalAmountFen: q.totalAmountFen,
      goodsAmountFen: q.goodsAmountFen,
      serviceFeeFen: q.serviceFeeFen,
      tailAdjustFen: q.tailAdjustFen,
      isFinalOrder: q.isFinalOrder,
      originalPriceFen: input.snapshot.originalPriceFen,
      unit: input.snapshot.unit,
      wholeQuantityText: input.snapshot.wholeQuantityText,
      referenceQuantityText: input.snapshot.referenceQuantityText,
      addressReceiverName: input.addressSnapshot.receiverName,
      addressPhone: input.addressSnapshot.phone,
      addressProvince: input.addressSnapshot.province,
      addressCity: input.addressSnapshot.city,
      addressDistrict: input.addressSnapshot.district,
      addressDetail: input.addressSnapshot.detail,
      reservationExpiresAt: input.reservationExpiresAt,
      idempotencyKey: input.idempotencyKey,
      paidAt: null,
      cancelledAt: null,
      expiredAt: null,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  static rehydrate(state: OrderState): Order {
    return new Order({ ...state });
  }

  get isUnpaid(): boolean {
    return this.state.status === 'unpaid';
  }

  cancel(now: Date): Order {
    if (this.state.status !== 'unpaid') throw new ApplicationError('ORDER_NOT_CANCELLABLE', '订单当前状态不可取消');
    return new Order({ ...this.state, status: 'cancelled', cancelledAt: now, updatedAt: now });
  }

  markExpired(now: Date): Order {
    if (this.state.status !== 'unpaid') throw new ApplicationError('ORDER_NOT_CANCELLABLE', '订单当前状态不可过期');
    return new Order({ ...this.state, status: 'expired', expiredAt: now, updatedAt: now });
  }

  markPaid(now: Date): Order {
    if (this.state.status !== 'unpaid') throw new ApplicationError('ORDER_NOT_CANCELLABLE', '订单当前状态不可支付');
    return new Order({ ...this.state, status: 'paid', paidAt: now, updatedAt: now });
  }
}
