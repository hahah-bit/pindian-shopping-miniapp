import type { BusinessEventScanPort } from './ports';
import type { RecordNotification } from './record-notification';

function formatFen(fen: number): string {
  const abs = Math.abs(Math.trunc(fen));
  return `${fen < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** D026 业务事件补抓：按幂等键扫描退款成功/拼单成功事实，补建用户通知（最终一致，延迟≈扫描间隔）。 */
export class CatchUpBusinessEvents {
  constructor(private readonly deps: { scanPort: BusinessEventScanPort; recorder: RecordNotification }) {}

  async execute(input: { limit?: number } = {}): Promise<{ created: number }> {
    const limit = input.limit ?? 100;
    let created = 0;
    const refunds = await this.deps.scanPort.findSucceededRefundsWithoutNotification(limit);
    for (const refund of refunds) {
      const result = await this.deps.recorder.execute({
        recipientUserId: refund.userId,
        eventType: 'refund.succeeded',
        title: '退款到账',
        body: `您的退款已到账（原路退回），金额 ${formatFen(refund.amountFen)} 元`,
        reference: { orderId: refund.orderId, refundId: refund.refundId },
        idempotencyKey: `refund.succeeded:${refund.refundId}`
      });
      if (!result.duplicated) created += 1;
    }
    const orders = await this.deps.scanPort.findSuccessGroupOrdersWithoutNotification(limit);
    for (const order of orders) {
      const result = await this.deps.recorder.execute({
        recipientUserId: order.userId,
        eventType: 'group.succeeded',
        title: '拼单成功',
        body: '您参与的拼单已成功，将按份额履约发货',
        reference: { orderId: order.orderId, groupId: order.groupId },
        idempotencyKey: `group.succeeded:${order.orderId}`
      });
      if (!result.duplicated) created += 1;
    }
    return { created };
  }
}
