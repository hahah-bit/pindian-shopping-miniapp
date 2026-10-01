import { ApplicationError } from '../../../shared/kernel';
import type { RefundRepositoryPort } from './refund-ports';

export interface MiniRefundView {
  id: string;
  status: 'requested' | 'submitted' | 'processing' | 'succeeded' | 'failed';
  amountFen: number;
  reason: string;
  createdAtText: string;
}

export interface MiniRefundQueriesDeps {
  payments: { findByOrderId(orderId: string): Promise<{ state: { paymentId: string; userId: string } } | null> };
  refunds: RefundRepositoryPort;
}

/** 小程序退款进度：仅本人订单可见；退款事实只读投影。 */
export class MiniRefundQueries {
  constructor(private readonly deps: MiniRefundQueriesDeps) {}

  async execute(input: { orderId: unknown; userId: unknown }): Promise<{ items: MiniRefundView[] }> {
    const orderId = typeof input.orderId === 'string' ? input.orderId : '';
    const userId = typeof input.userId === 'string' ? input.userId : '';
    const payment = await this.deps.payments.findByOrderId(orderId);
    if (!payment || payment.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
    const refunds = await this.deps.refunds.findByPaymentId(payment.state.paymentId);
    return {
      items: refunds.map((refund) => ({
        id: refund.state.refundId,
        status: refund.state.status,
        amountFen: refund.state.amountFen,
        reason: refund.state.reason,
        createdAtText: refund.state.requestedAt.toISOString()
      }))
    };
  }
}
