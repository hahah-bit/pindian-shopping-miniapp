import { ApplicationError } from '../../../shared/kernel';

export type RefundStatus = 'requested' | 'submitted' | 'processing' | 'succeeded' | 'failed';
export type RefundReason = 'user_cancel' | 'group_failed' | 'late_payment' | 'after_sales';

export const MAX_REFUND_RETRIES = 5;

export interface RefundState {
  refundId: string;
  paymentId: string;
  orderId: string;
  userId: string;
  outRefundNo: string;
  amountFen: number;
  status: RefundStatus;
  reason: RefundReason;
  channelRefundId: string | null;
  failReason: string | null;
  retryCount: number;
  requestedAt: Date;
  succeededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 退款单号：RF-{orderId 前 8}-{随机 24}，渠道幂等键（同号重复请求只退一笔）。 */
export function generateOutRefundNo(orderId: string, randomHex: () => string): string {
  return `RF${orderId.replace(/-/g, '').slice(0, 16)}${randomHex().slice(0, 16)}`.slice(0, 40);
}

export class Refund {
  private constructor(readonly state: RefundState) {}

  static create(input: { refundId?: string; paymentId: string; orderId: string; userId: string; amountFen: number; reason: RefundReason; now: Date; randomHex?: () => string }): Refund {
    if (!Number.isInteger(input.amountFen) || input.amountFen < 1) throw new ApplicationError('VALIDATION_FAILED', '退款金额非法');
    if (!['user_cancel', 'group_failed', 'late_payment', 'after_sales'].includes(input.reason)) throw new ApplicationError('VALIDATION_FAILED', '退款原因非法');
    const randomHex = input.randomHex ?? (() => crypto.randomUUID().replace(/-/g, ''));
    return new Refund({
      refundId: input.refundId ?? crypto.randomUUID(),
      paymentId: input.paymentId,
      orderId: input.orderId,
      userId: input.userId,
      outRefundNo: generateOutRefundNo(input.orderId, randomHex),
      amountFen: input.amountFen,
      status: 'requested',
      reason: input.reason,
      channelRefundId: null,
      failReason: null,
      retryCount: 0,
      requestedAt: input.now,
      succeededAt: null,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  static rehydrate(state: RefundState): Refund {
    return new Refund({ ...state });
  }

  get outRefundNoSafe(): string {
    return this.state.outRefundNo;
  }

  markSubmitted(now: Date): Refund {
    if (this.state.status !== 'requested' && this.state.status !== 'failed') {
      throw new ApplicationError('REFUND_NOT_ALLOWED', '退款单当前状态不可提交');
    }
    return new Refund({ ...this.state, status: 'submitted', retryCount: this.state.retryCount + (this.state.status === 'failed' ? 1 : 0), updatedAt: now });
  }

  markProcessing(now: Date): Refund {
    if (this.state.status !== 'submitted') throw new ApplicationError('REFUND_NOT_ALLOWED', '退款单未提交，无法进入处理中');
    return new Refund({ ...this.state, status: 'processing', updatedAt: now });
  }

  /** 仅渠道证据（回调/查询 SUCCESS）可标记成功；渠道退款单号随证据记录（首次为准）。 */
  markSucceeded(now: Date, channelRefundId?: string): Refund {
    if (this.state.status !== 'processing' && this.state.status !== 'submitted') {
      throw new ApplicationError('REFUND_NOT_ALLOWED', '退款单当前状态不可标记成功');
    }
    return new Refund({ ...this.state, status: 'succeeded', channelRefundId: channelRefundId ?? this.state.channelRefundId, succeededAt: now, updatedAt: now });
  }

  markFailed(reason: string, now: Date): Refund {
    if (this.state.status !== 'processing' && this.state.status !== 'submitted') {
      throw new ApplicationError('REFUND_NOT_ALLOWED', '退款单当前状态不可标记失败');
    }
    return new Refund({ ...this.state, status: 'failed', failReason: reason.slice(0, 200), updatedAt: now });
  }

  /** 人工安全重试：仅 failed 且重试未超限。 */
  canRetry(now: Date): boolean {
    return this.state.status === 'failed' && this.state.retryCount < MAX_REFUND_RETRIES;
  }

  /** 人工重试重置：failed → requested（retryCount +1），由退款驱动按幂等键重新提交。 */
  markRetryRequested(now: Date): Refund {
    if (!this.canRetry(now)) {
      throw new ApplicationError('REFUND_NOT_ALLOWED', `仅失败状态且重试未超 ${MAX_REFUND_RETRIES} 次可重试`);
    }
    return new Refund({ ...this.state, status: 'requested', retryCount: this.state.retryCount + 1, updatedAt: now });
  }
}
