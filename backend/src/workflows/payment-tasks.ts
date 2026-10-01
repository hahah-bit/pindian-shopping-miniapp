import type { Clock } from '../shared/kernel';
import type { PaymentRepository } from '../contexts/payments/application/ports';

import { Payment } from '../contexts/payments/domain/payment';
import { ConfirmPaymentWorkflow } from './payment-confirm.workflow';
import { RefundDriver } from '../contexts/payments/application/refund-flow';
import type { RefundsDeps } from '../contexts/payments/application/refund-ports';

/** 支付查询补偿（Worker 任务 3，D010）：unknown/processing 且超过静默期的单 → 渠道查询 → 应用流程。 */
export class PaymentQueryCompensationTask {
  constructor(private readonly deps: {
    payments: PaymentRepository;
    channel: { queryOrderByOutTradeNo(outTradeNo: string): Promise<{ tradeState: string; transactionId?: string; payerTotal?: number }> };
    confirm: ConfirmPaymentWorkflow;
    runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
    clock: Clock;
    staleAfterMs?: number;
  }) {}

  async execute(input: { limit?: number }): Promise<number> {
    const limit = input.limit ?? 100;
    const now = this.deps.clock.now();
    const staleAfterMs = this.deps.staleAfterMs ?? 30_000;
    const stale = await (this.deps.payments as unknown as { findStale(now: Date, limit: number): Promise<Payment[]> }).findStale(now, limit);
    let processed = 0;
    for (const payment of stale) {
      try {
        const result = await this.deps.channel.queryOrderByOutTradeNo(payment.state.outTradeNo);
        if (result.tradeState === 'SUCCESS' && result.transactionId) {
          await this.deps.confirm.execute({
            channelFact: { outTradeNo: payment.state.outTradeNo, channelTransactionId: result.transactionId, payerTotal: result.payerTotal ?? payment.state.amountFen },
            source: 'query'
          });
          processed++;
        }
        // NOTPAY：保持 processing 等待（不误关单；过期由预占过期任务与订单过期处理）
      } catch (error) {
        console.error('[pay-query] 查询补偿失败', payment.state.outTradeNo, error instanceof Error ? error.message : error);
      }
    }
    void staleAfterMs;
    return processed;
  }
}

/** 异常统计（后台人工处理入口数据源）。 */
export class AnomalyStatsTask {
  constructor(private readonly deps: {
    countPendingReviewPayments: () => Promise<number>;
    countFailedRefunds: () => Promise<number>;
  }) {}

  async execute(): Promise<{ pendingReviewPayments: number; failedRefunds: number }> {
    return {
      pendingReviewPayments: await this.deps.countPendingReviewPayments(),
      failedRefunds: await this.deps.countFailedRefunds()
    };
  }
}

// RefundDriveTask 是 RefundDriver 的任务化别名（保持命名一致）
export { RefundDriver as RefundDriveTask };
