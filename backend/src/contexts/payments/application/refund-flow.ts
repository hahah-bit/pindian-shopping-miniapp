import { ApplicationError, type Clock } from '../../../shared/kernel';
import { Refund, MAX_REFUND_RETRIES } from '../domain/refund';
import type { PaymentRepository, PaymentChannelPort } from './ports';
import type { RefundRepositoryPort, RefundsDeps } from './refund-ports';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidOf(input: unknown, label: string): string {
  if (typeof input !== 'string' || !UUID_PATTERN.test(input)) throw new ApplicationError('VALIDATION_FAILED', `${label}格式无效`);
  return input;
}

export interface RefundGroupPort {
  /** 组 open 时取消已支付订单：paid 扣减（容量即扣）。返回组是否存在且 open。 */
  deductPaidForCancel(groupId: string, units: number, amountFen: number, goodsFen: number, now: Date, sessionTx: unknown): Promise<boolean>;
  findByIdForUpdate(groupId: string, sessionTx: unknown): Promise<{ state: { status: string }; isJoinable: boolean } | null>;
}

export interface RefundOrderAggregateView {
  state: { orderId: string; userId: string; status: string; units: number; groupId: string; totalAmountFen: number; goodsAmountFen: number };
  cancel(now: Date): unknown;
}

export interface RefundOrderPort {
  findById(orderId: string): Promise<RefundOrderAggregateView | null>;
  save(order: RefundOrderAggregateView, sessionTx?: unknown): Promise<void>;
}

/** 创建全额退款单（依据支付事实；D009）。累计非失败退款不得超实付。 */
export class CreateFullRefundUseCase {
  constructor(private readonly deps: { refunds: RefundRepositoryPort; payments: PaymentRepository; clock: Clock }) {}

  async execute(input: { paymentId: unknown; orderId: unknown; userId: unknown; reason: 'user_cancel' | 'group_failed' | 'late_payment' }): Promise<{ refundId: string }> {
    const paymentId = uuidOf(input.paymentId, '支付单 ID');
    const orderId = uuidOf(input.orderId, '订单 ID');
    const payment = await this.deps.payments.findById(paymentId);
    if (!payment || payment.state.status !== 'succeeded') {
      throw new ApplicationError('REFUND_NOT_ALLOWED', '无已成功的支付事实，不能退款');
    }
    const existing = await this.deps.refunds.findByPaymentId(paymentId);
    const activeSum = existing
      .filter((r) => r.state.status !== 'failed')
      .reduce((sum, r) => sum + r.state.amountFen, 0);
    if (activeSum + payment.state.amountFen > payment.state.amountFen) {
      throw new ApplicationError('REFUND_EXCEED_LIMIT', '累计退款超过实付金额');
    }
    if (existing.length > 0) {
      throw new ApplicationError('REFUND_EXCEED_LIMIT', '该支付单已存在退款单（全额退款单笔完成）');
    }
    const refund = Refund.create({
      paymentId, orderId, userId: payment.state.userId,
      amountFen: payment.state.amountFen, reason: input.reason, now: this.deps.clock.now()
    });
    await this.deps.refunds.insert(refund);
    return { refundId: refund.state.refundId };
  }
}

/** 取消已支付订单工作流（D007）：组 open 时申请即扣容量 + Refund requested + 订单 cancelled，同事务。 */
export class CancelPaidOrderWorkflow {
  constructor(private readonly deps: { groups: RefundGroupPort; orders: RefundOrderPort; payments: PaymentRepository; refunds: RefundRepositoryPort; creator: CreateFullRefundUseCase; runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> }; clock: Clock }) {}

  async execute(input: { userId: unknown; orderId: unknown; requestId: unknown }): Promise<{ cancelled: true; refundId: string }> {
    const userId = uuidOf(input.userId, '用户身份');
    const orderId = uuidOf(input.orderId, '订单 ID');
    const refundId = await this.deps.runner.run(async (sessionTx) => {
      const order = await this.deps.orders.findById(orderId);
      if (!order || order.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
      if (order.state.status !== 'paid') throw new ApplicationError('ORDER_NOT_CANCELLABLE', '订单当前状态不可取消（未支付订单可直接取消，已失效订单无需取消）');
      const group = await this.deps.groups.findByIdForUpdate(order.state.groupId, sessionTx);
      if (!group || group.state.status !== 'open') throw new ApplicationError('ORDER_NOT_CANCELLABLE', '拼单已成功，请通过售后处理');
      const payment = await this.deps.payments.findByOrderId(orderId);
      if (!payment || payment.state.status !== 'succeeded' || payment.state.appliedResult !== 'applied') {
        throw new ApplicationError('REFUND_NOT_ALLOWED', '无已生效支付事实');
      }
      const existing = await this.deps.refunds.findByPaymentId(payment.state.paymentId);
      if (existing.length > 0) throw new ApplicationError('REFUND_NOT_ALLOWED', '退款已在处理中');
      const { refundId } = await this.deps.creator.execute({ paymentId: payment.state.paymentId, orderId, userId, reason: 'user_cancel' });
      const deducted = await this.deps.groups.deductPaidForCancel(order.state.groupId, order.state.units, order.state.totalAmountFen, order.state.goodsAmountFen, this.deps.clock.now(), sessionTx);
      if (!deducted) throw new ApplicationError('ORDER_NOT_CANCELLABLE', '拼单已成功，请通过售后处理');
      const current = await this.deps.orders.findById(orderId);
      if (current && typeof (current as RefundOrderAggregateView & { cancelPaid(now: Date): unknown }).cancelPaid === 'function') {
        await this.deps.orders.save((current as RefundOrderAggregateView & { cancelPaid(now: Date): unknown }).cancelPaid(this.deps.clock.now()) as never, sessionTx);
      }
      return refundId;
    });
    return { cancelled: true, refundId };
  }
}

/** 退款驱动（Worker 任务 4，D009/D010）：requested → 提交渠道；processing → 查询。 */
export class RefundDriver {
  constructor(private readonly deps: RefundsDeps) {}

  async execute(input: { limit?: number }): Promise<number> {
    const limit = input.limit ?? 100;
    const now = this.deps.clock.now();
    let processed = 0;
    for (const refund of await this.deps.refunds.findRefundDueForSubmit(now, limit)) {
      try {
        const payment = await this.deps.payments.findById(refund.state.paymentId);
        if (!payment) throw new Error('payment missing');
        // D009 状态机：requested → submitted（提交渠道）→ processing（渠道受理）
        const submitted = refund.markSubmitted(now);
        const result = await this.deps.channel.submitRefund({
          outTradeNo: submitted.state.orderId,
          outRefundNo: submitted.state.outRefundNo,
          refundFen: submitted.state.amountFen,
          totalFen: payment.state.amountFen,
          reason: submitted.state.reason
        });
        if (result.status === 'SUCCESS') {
          await this.deps.refunds.save(submitted.markSucceeded(now));
        } else {
          await this.deps.refunds.save(submitted.markProcessing(now));
        }
        processed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[refund-driver] 提交失败', refund.state.refundId, message);
        // 提交异常必须落 failed（异常队列可见、人工可重试），不能无限静默重试
        try {
          const failed = refund.markSubmitted(now).markFailed(message, now);
          await this.deps.refunds.save(failed);
        } catch (markError) {
          console.error('[refund-driver] 失败状态落库失败', refund.state.refundId, markError instanceof Error ? markError.message : markError);
        }
      }
    }
    for (const refund of await this.deps.refunds.findRefundDueForQuery(now, limit)) {
      try {
        const result = await this.deps.channel.queryRefund(refund.state.outRefundNo);
        if (result.status === 'SUCCESS') await this.deps.refunds.save(refund.markSucceeded(now));
        else if (result.status === 'ABNORMAL' || result.status === 'CLOSED') await this.deps.refunds.save(refund.markFailed(result.status, now));
        else processed++;
      } catch (error) {
        console.error('[refund-driver] 查询失败', refund.state.refundId, error instanceof Error ? error.message : error);
      }
    }
    return processed;
  }
}

/** 人工安全重试（仅 failed；权限+原因+审计由入口保证）。 */
export class RetryRefund {
  constructor(private readonly deps: { refunds: RefundRepositoryPort; channel: PaymentChannelPort; audit: { execute(entry: { adminId: unknown; action: string; resourceType: string; resourceId: string; requestId: unknown }): Promise<void> }; runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> }; clock: Clock }) {}

  async execute(input: { refundId: unknown; adminId: unknown; requestId: unknown; reason: unknown }): Promise<{ status: string }> {
    const refundId = uuidOf(input.refundId, '退款单 ID');
    if (typeof input.reason !== 'string' || input.reason.trim().length === 0) {
      throw new ApplicationError('VALIDATION_FAILED', '重试原因必填');
    }
    const refund = await this.deps.refunds.findById(refundId);
    if (!refund) throw new ApplicationError('NOT_FOUND', '退款单不存在');
    if (!refund.canRetry(this.deps.clock.now())) {
      throw new ApplicationError('REFUND_NOT_ALLOWED', `仅失败状态且重试次数未超 ${MAX_REFUND_RETRIES} 次可重试`);
    }
    // 重置为 requested：退款驱动按幂等键 out_refund_no 重新提交；retryCount 在此递增
    const retried = refund.markRetryRequested(this.deps.clock.now());
    await this.deps.refunds.save(retried);
    if (this.deps.audit) {
      await this.deps.audit.execute({ adminId: input.adminId, action: 'refund.retry', resourceType: 'refund', resourceId: refundId, requestId: input.requestId });
    }
    return { status: retried.state.status };
  }
}

/** 退款结果确认（回调/查询共用，幂等）。 */
export class RefundResultConfirmer {
  constructor(private readonly deps: { refunds: RefundRepositoryPort; runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> }; clock: Clock }) {}

  async execute(input: { outRefundNo: unknown; result: 'SUCCESS' | 'ABNORMAL' | 'CLOSED' | 'PROCESSING'; source: 'callback' | 'query' }): Promise<string> {
    const outRefundNo = typeof input.outRefundNo === 'string' ? input.outRefundNo : '';
    const refund = await this.deps.refunds.findByOutRefundNo(outRefundNo);
    if (!refund) throw new ApplicationError('NOT_FOUND', '退款单不存在');
    const now = this.deps.clock.now();
    if (input.result === 'SUCCESS') {
      const updated = refund.markSucceeded(now);
      await this.deps.refunds.save(updated);
      return 'succeeded';
    }
    if (input.result === 'ABNORMAL' || input.result === 'CLOSED') {
      const updated = refund.markFailed(input.result, now);
      await this.deps.refunds.save(updated);
      return 'failed';
    }
    return refund.state.status;
  }
}
