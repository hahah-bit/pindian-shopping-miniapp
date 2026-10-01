import { Payment } from '../domain/payment';
import type { PaymentRepository } from './ports';

export interface MarkPaymentNotAppliedRefunderDeps {
  refunds: { createFullRefund(input: { paymentId: string; orderId: string; userId: string; reason: 'late_payment' }): Promise<{ refundId: string }> };
}

/** 不可生效支付的事实入库后：标记 refunded_not_applied 并建全额自动退款单（D008）。 */
export class MarkPaymentNotAppliedRefunder {
  constructor(private readonly deps: MarkPaymentNotAppliedRefunderDeps) {}

  async execute(input: { payment: Payment; reason?: 'late_payment' }): Promise<void> {
    const marked = input.payment.markAppliedResult('refunded_not_applied');
    await (this.deps as unknown as { save(marked: Payment): Promise<void> }).save?.(marked);
    await this.deps.refunds.createFullRefund({
      paymentId: marked.state.paymentId,
      orderId: marked.state.orderId,
      userId: marked.state.userId,
      reason: input.reason ?? 'late_payment'
    });
  }
}
