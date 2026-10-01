import type { Clock } from '../shared/kernel';
import { Payment } from '../contexts/payments/domain/payment';
import { Group } from '../contexts/group-buying/domain/group';
import { ShareReservation } from '../contexts/group-buying/domain/share-reservation';
import { Order } from '../contexts/ordering/domain/order';
import type { PaymentRepository } from '../contexts/payments/application/ports';
import type { RefundCreationPort } from './payment-confirm.ports';

export interface ConfirmPaymentDeps {
  groups: {
    findByIdForUpdate(groupId: string, sessionTx: unknown): Promise<Group | null>;
    findById(groupId: string): Promise<Group | null>;
    save(group: Group, sessionTx?: unknown): Promise<void>;
    /** D006 让利台账：组成功同事务落账（幂等）。 */
    recordSettlement(input: { groupId: string; expectedTotalFen: number; settledTotalFen: number; diffFen: number; now: Date }, sessionTx?: unknown): Promise<void>;
  };
  reservations: {
    findByOrderId(orderId: string, sessionTx?: unknown): Promise<ShareReservation | null>;
    save(reservation: ShareReservation, sessionTx?: unknown): Promise<void>;
  };
  orders: {
    findById(orderId: string): Promise<Order | null>;
    save(order: Order, sessionTx?: unknown): Promise<void>;
  };
  payments: {
    findByOrderId(orderId: string): Promise<Payment | null>;
    insert(payment: Payment, sessionTx?: unknown): Promise<void>;
    save(payment: Payment, sessionTx?: unknown): Promise<void>;
  };
  refunds: RefundCreationPort;
  stocks: { consumeOne(productId: string, businessKey: string, sessionTx?: unknown): Promise<void> };
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}

export interface ChannelPaymentFact {
  outTradeNo: string;
  channelTransactionId: string;
  payerTotal: number;
  payload?: Record<string, unknown>;
}

/**
 * 支付确认工作流（D006–D010）：
 * 1. 渠道事实入账（channel_transaction_id 唯一，重复通知幂等）；
 * 2. 金额核验（与订单快照不符 → pending_review 异常）；
 * 3. 可生效判定（订单 unpaid + 预占有效 + 组 open，全部在行锁事务内）→
 *    预占转已支付 + 组金额/单位更新 + 组满判定 + 整件消耗 + 订单 paid（同事务）；
 * 4. 不可生效 → 事实入库 + 全额自动退款（D008 迟到支付）。
 */
export class ConfirmPaymentWorkflow {
  constructor(private readonly deps: ConfirmPaymentDeps) {}

  async execute(input: { channelFact: ChannelPaymentFact; source: 'callback' | 'query' }): Promise<boolean> {
    const fact = input.channelFact;
    const now = this.deps.clock.now();
    const payment = await this.deps.payments.findByOrderId(fact.outTradeNo);
    const order = await this.deps.orders.findById(fact.outTradeNo);
    if (!payment || !order) {
      // 渠道事实先于本地支付单（发起超时后支付）——事实已在回调入账阶段落库，此处仅记录
      console.error('[payment-confirm] 本地无支付单，等待事实入账', fact.outTradeNo);
      return false;
    }
    if (payment.state.status === 'succeeded') return true; // 重复通知幂等

    // 金额核验（G10）
    if (fact.payerTotal !== order.state.totalAmountFen) {
      await this.deps.payments.save(payment.markSucceeded({ channelTransactionId: fact.channelTransactionId, source: input.source, payload: fact.payload, now }).markAppliedResult('pending_review'));
      return false;
    }

    const succeeded = payment.markSucceeded({ channelTransactionId: fact.channelTransactionId, source: input.source, payload: fact.payload, now });

    // A03（复验）：应用、支付事实、迟到退款在**同一事务**——退款建单失败整体回滚，
    // 支付单停留原态可由重放恢复；提交后重放被 succeeded 早退挡住，不会重复退款。
    const outcome = await this.deps.runner.run(async (sessionTx) => {
      const lockedOrder = await this.deps.orders.findById(fact.outTradeNo);
      if (!lockedOrder) return { applied: false, reason: 'missing' as const };
      if (lockedOrder.state.status !== 'unpaid') return { applied: false, reason: 'order_not_unpaid' as const };
      const lockedGroup = await this.deps.groups.findByIdForUpdate(lockedOrder.state.groupId, sessionTx);
      if (!lockedGroup || !lockedGroup.isOpen || lockedGroup.state.deadline <= now) return { applied: false, reason: 'group_closed' as const };
      const reservation = await this.deps.reservations.findByOrderId(lockedOrder.state.orderId, sessionTx);
      if (!reservation || reservation.state.status !== 'reserved') return { applied: false, reason: 'no_reservation' as const };
      // 预占过期检查（任务未跑时兜底，D008）
      if (!reservation.isActive(now)) return { applied: false, reason: 'reservation_expired' as const };
      // 转换语义：预占已持有容量，生效只是 reserved→paid，不新占容量（capacity 检查由 withPaidUnits 的 reserved<0 防护）

      // 生效：预占 converted + 组 paid/amount += + 订单 paid
      const converted = reservation.convert(now);
      const paidGroup = lockedGroup.withPaidUnits(converted.state.units, now)
        .withPaidAmount(lockedOrder.state.totalAmountFen, lockedOrder.state.goodsAmountFen, now);
      const finalGroup = paidGroup.state.paidUnits === 60 ? paidGroup.markSuccess(now) : paidGroup;
      const paidOrder = lockedOrder.markPaid(now);
      await this.deps.reservations.save(converted, sessionTx);
      await this.deps.groups.save(finalGroup, sessionTx);
      await this.deps.orders.save(paidOrder, sessionTx);
      await this.deps.payments.save(succeeded.markAppliedResult('applied'), sessionTx);
      if (finalGroup.state.status === 'success') {
        await this.deps.stocks.consumeOne(finalGroup.state.productId, `group-consume:${finalGroup.state.groupId}`, sessionTx);
        // D006 让利台账：expected = 组售价快照（原价+服务费）；settled = 组累计已支付；diff 可追溯
        await this.deps.groups.recordSettlement({
          groupId: finalGroup.state.groupId,
          expectedTotalFen: finalGroup.state.snapshot.userWholePriceFen,
          settledTotalFen: finalGroup.state.paidAmountFen,
          diffFen: finalGroup.state.snapshot.userWholePriceFen - finalGroup.state.paidAmountFen,
          now
        }, sessionTx);
      }
      return { applied: true, reason: 'ok' as const };
    });

    if (outcome.applied) return outcome.applied;

    // D008：迟到/不可生效支付 → 支付事实与全额退款（late_payment）同事务；退款失败整体回滚可重放
    await this.deps.runner.run(async (sessionTx) => {
      await this.deps.payments.save(succeeded.markAppliedResult('refunded_not_applied'), sessionTx);
      await this.deps.refunds.createFullRefund({
        paymentId: succeeded.state.paymentId,
        orderId: fact.outTradeNo,
        userId: order.state.userId,
        amountFen: order.state.totalAmountFen,
        reason: 'late_payment'
      }, sessionTx);
    });
    return outcome.applied;
  }
}
