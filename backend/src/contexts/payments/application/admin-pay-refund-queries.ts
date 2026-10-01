import type { PaymentRepository } from './ports';
import type { RefundRepositoryPort } from './refund-ports';

export class AdminPayRefundQueries {
  constructor(private readonly deps: {
    payments: PaymentRepository;
    refunds: RefundRepositoryPort;
    nicknameOf: (userId: string) => Promise<string>;
  }) {}

  async listPayments(query: { status?: string | null; page: number; pageSize: number }) {
    const { items, total } = await this.deps.payments.listAdmin(query);
    return {
      items: items.map((p) => ({
        id: p.state.paymentId,
        orderNo: p.state.outTradeNo,
        status: p.state.status,
        amountFen: p.state.amountFen,
        channelTransactionId: p.state.channelTransactionId ?? undefined,
        appliedResult: p.state.appliedResult ?? undefined,
        createdAt: p.state.createdAt
      })),
      total
    };
  }

  async listRefunds(query: { status?: string | null; page: number; pageSize: number }) {
    const { items, total } = await this.deps.refunds.listAdmin(query);
    const rows = await Promise.all(items.map(async (r) => ({
      id: r.state.refundId,
      orderNo: r.state.orderId,
      nickname: await this.deps.nicknameOf(r.state.userId),
      amountFen: r.state.amountFen,
      status: r.state.status,
      reason: r.state.reason,
      retryCount: r.state.retryCount,
      failReason: r.state.failReason ?? undefined,
      createdAt: r.state.createdAt
    })));
    return { items: rows, total };
  }

  async countPendingReview() {
    return this.deps.payments.countByStatus('pending_review');
  }

  async countFailedRefunds() {
    return this.deps.refunds.countFailedRefunds();
  }
}
