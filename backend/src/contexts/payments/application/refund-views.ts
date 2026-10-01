import { ApplicationError } from '../../../shared/kernel';
import type { RefundRepositoryPort } from './refund-ports';
import type { PaymentRepository } from './ports';

/** 后台退款查询投影：脱敏（无手机号/地址），昵称由用户域提供。 */
export class RefundQueries {
  constructor(private readonly deps: { refunds: RefundRepositoryPort; payments: PaymentRepository; nicknameOf: (userId: string) => Promise<string> }) {}

  async list(query: { status?: unknown; page?: unknown; pageSize?: unknown }) {
    const status = typeof query.status === 'string' && ['requested', 'submitted', 'processing', 'succeeded', 'failed'].includes(query.status) ? query.status : null;
    const page = typeof query.page === 'number' && Number.isInteger(query.page) && query.page >= 1 ? query.page : 1;
    const pageSize = typeof query.pageSize === 'number' && Number.isInteger(query.pageSize) && query.pageSize >= 1 ? Math.min(query.pageSize, 50) : 10;
    const { items, total } = await this.deps.refunds.listAdmin({ status, page, pageSize });
    const rows = await Promise.all(items.map(async (refund) => ({
      id: refund.state.refundId,
      orderNo: refund.state.orderId,
      nickname: await this.deps.nicknameOf(refund.state.userId),
      amountFen: refund.state.amountFen,
      status: refund.state.status,
      reason: refund.state.reason,
      retryCount: refund.state.retryCount,
      failReason: refund.state.failReason ?? undefined,
      createdAt: refund.state.createdAt.toISOString()
    })));
    return { items: rows, page, pageSize, total };
  }
}
