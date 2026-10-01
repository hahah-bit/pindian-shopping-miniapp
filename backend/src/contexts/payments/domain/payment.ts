import { ApplicationError } from '../../../shared/kernel';

export type PaymentStatus = 'created' | 'processing' | 'succeeded' | 'closed' | 'unknown';
export type AppliedResult = 'applied' | 'refunded_not_applied' | 'pending_review' | null;

export interface PaymentState {
  paymentId: string;
  orderId: string;
  userId: string;
  amountFen: number;
  status: PaymentStatus;
  outTradeNo: string;
  channelTransactionId: string | null;
  appliedResult: AppliedResult;
  prepayId: string | null;
  prepayExpiresAt: Date | null;
  successSource: 'callback' | 'query' | null;
  channelPayload: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export const PREPAY_TTL_MS = 2 * 3600_000;

/** 支付单聚合根：渠道事实唯一（channel_transaction_id），生效应用幂等。 */
export class Payment {
  private constructor(readonly state: PaymentState) {}

  static create(input: { paymentId?: string; orderId: string; userId: string; amountFen: number; prepayId: string; now: Date; status?: PaymentStatus }): Payment {
    if (!Number.isInteger(input.amountFen) || input.amountFen < 1) throw new ApplicationError('VALIDATION_FAILED', '支付金额非法');
    return new Payment({
      paymentId: input.paymentId ?? crypto.randomUUID(),
      orderId: input.orderId,
      userId: input.userId,
      amountFen: input.amountFen,
      status: input.status ?? 'processing',
      outTradeNo: input.orderId,
      channelTransactionId: null,
      appliedResult: null,
      prepayId: input.prepayId,
      prepayExpiresAt: new Date(input.now.getTime() + PREPAY_TTL_MS),
      successSource: null,
      channelPayload: null,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  static createUnknown(input: { paymentId?: string; orderId: string; userId: string; amountFen: number; now: Date }): Payment {
    return Payment.create({ ...input, prepayId: 'pending-query', status: 'unknown' });
  }

  static rehydrate(state: PaymentState): Payment {
    return new Payment({ ...state });
  }

  prepayUsable(now: Date): boolean {
    return (this.state.status === 'processing' || this.state.status === 'unknown') &&
      this.state.prepayId !== null && this.state.prepayId !== 'pending-query' &&
      this.state.prepayExpiresAt !== null && this.state.prepayExpiresAt > now;
  }

  markSucceeded(input: { channelTransactionId: string; source: 'callback' | 'query'; payload?: Record<string, unknown>; now: Date }): Payment {
    if (this.state.status === 'succeeded') return this;
    if (this.state.status === 'closed') throw new ApplicationError('VALIDATION_FAILED', '已关闭支付单不可标成功');
    if (input.channelTransactionId && this.state.channelTransactionId && this.state.channelTransactionId !== input.channelTransactionId) {
      throw new ApplicationError('VALIDATION_FAILED', '渠道交易号不一致');
    }
    return new Payment({
      ...this.state,
      status: 'succeeded',
      channelTransactionId: input.channelTransactionId ?? this.state.channelTransactionId,
      successSource: input.source,
      channelPayload: input.payload ?? this.state.channelPayload,
      updatedAt: input.now
    });
  }

  markClosed(now: Date): Payment {
    if (this.state.status === 'succeeded') throw new ApplicationError('VALIDATION_FAILED', '已成功支付单不可关闭');
    return new Payment({ ...this.state, status: 'closed', updatedAt: now });
  }

  /** 生效应用结果：applied 幂等不可变；refunded_not_applied/pending_review 互斥。 */
  markAppliedResult(result: Exclude<AppliedResult, null>): Payment {
    if (this.state.appliedResult === result) return this;
    if (this.state.appliedResult !== null) throw new ApplicationError('VALIDATION_FAILED', '支付单应用结果已存在且不可变更');
    return new Payment({ ...this.state, appliedResult: result, updatedAt: new Date(this.state.updatedAt.getTime() + 1) });
  }
}
