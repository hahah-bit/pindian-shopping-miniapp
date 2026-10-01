import { ApplicationError, SystemClock, type Clock } from '../../../shared/kernel';
import { Payment } from '../domain/payment';
import type { InitiatePaymentDeps } from './ports';

export interface PayParamsView {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

export interface InitiatePaymentResult {
  paymentId: string;
  status: 'processing' | 'unknown';
  payParams?: PayParamsView;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(input: unknown, label: string): string {
  if (typeof input !== 'string' || !UUID_PATTERN.test(input)) throw new ApplicationError('VALIDATION_FAILED', `${label}格式无效`);
  return input;
}

/**
 * 发起支付（D010）：核验归属/状态/资格 → 渠道下单（事务外，超时=unknown 不认定失败）
 * → 短事务落库；重复发起幂等（prepay 2h 内复用）。
 */
export class InitiatePayment {
  constructor(private readonly deps: InitiatePaymentDeps) {}

  async execute(input: { orderId: unknown; userId: unknown }): Promise<InitiatePaymentResult> {
    const orderId = requireUuid(input.orderId, '订单 ID');
    const userId = requireUuid(input.userId, '用户身份');
    if (!this.deps.payConfig.configured) {
      throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置，无法发起支付');
    }

    const existing = await this.deps.payments.findByOrderId(orderId);
    const now = this.deps.clock.now();
    if (existing && existing.prepayUsable(now)) {
      return { paymentId: existing.state.paymentId, status: 'processing', payParams: this.signParams(existing.state.prepayId!, now) };
    }

    const order = await this.deps.orders.findById(orderId);
    if (!order || order.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
    if (order.status !== 'unpaid') throw new ApplicationError('ORDER_NOT_PAYABLE', '订单当前状态不可支付');
    const groupJoinable = await this.deps.groups.isJoinable(order.groupId);
    if (!groupJoinable) throw new ApplicationError('ORDER_NOT_PAYABLE', '拼单组已结束，无法支付');
    if (order.reservationExpiresAt <= now) throw new ApplicationError('ORDER_NOT_PAYABLE', '份额保留已过期，请重新下单');

    const openid = await this.deps.users.getOpenid(userId);
    if (!openid) throw new ApplicationError('VALIDATION_FAILED', '缺少支付所需用户标识');

    let prepayId: string;
    try {
      const result = await this.deps.channel.createJsapiOrder({
        outTradeNo: orderId,
        amountFen: order.totalAmountFen,
        openid,
        description: '拼单商品份额',
        notifyUrl: this.deps.payConfig.notifyUrl
      });
      prepayId = result.prepayId;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'NOT_CONFIGURED') throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置，无法发起支付');
      if (code === 'CHANNEL_TIMEOUT') {
        // 外部超时属结果未知：不认定失败，不重复下单——短事务记录 unknown，查询补偿接管（D010）
        const payment = Payment.createUnknown({ orderId, userId, amountFen: order.totalAmountFen, now });
        await this.deps.runner.run(async () => { await this.deps.payments.insert(payment); });
        return { paymentId: payment.state.paymentId, status: 'unknown' };
      }
      if (code === 'OUT_TRADE_NO_USED') {
        // 同号已用：渠道可能已有单——查询确认后按结果恢复本地支付单
        const q = await this.deps.channel.queryOrderByOutTradeNo(orderId);
        if (q.tradeState === 'SUCCESS' && q.transactionId) {
          const payment = Payment.create({ orderId, userId, amountFen: order.totalAmountFen, prepayId: 'recovered', now });
          const succeeded = payment.markSucceeded({ channelTransactionId: q.transactionId, source: 'query', now });
          await this.deps.runner.run(async () => { await this.deps.payments.insert(succeeded); });
          return { paymentId: succeeded.state.paymentId, status: 'processing' };
        }
        // NOTPAY/CLOSED：渠道单存在但未成功——本地恢复 processing 单占位（prepay 需重新下单，暂用 recovered 标记，下次发起重新下单）
        const recovered = Payment.create({ orderId, userId, amountFen: order.totalAmountFen, prepayId: 'recovered', now });
        await this.deps.runner.run(async () => { await this.deps.payments.insert(recovered); });
        return { paymentId: recovered.state.paymentId, status: 'processing' };
      }
      throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付渠道暂时不可用，请稍后重试');
    }

    const payment = Payment.create({ orderId, userId, amountFen: order.totalAmountFen, prepayId, now });
    await this.deps.runner.run(async () => { await this.deps.payments.insert(payment); });
    return { paymentId: payment.state.paymentId, status: 'processing', payParams: this.signParams(prepayId, now) };
  }

  /** 调起支付参数：paySign 由渠道适配器用商户私钥 RSA 签名。 */
  private signParams(prepayId: string, _now: Date): PayParamsView {
    const pkg = `prepay_id=${prepayId}`;
    return {
      timeStamp: String(Math.floor(this.deps.clock.now().getTime() / 1000)),
      nonceStr: crypto.randomUUID().replace(/-/g, ''),
      package: pkg,
      signType: 'RSA',
      paySign: this.deps.channel.signPayParams ? this.deps.channel.signPayParams(pkg) : ''
    };
  }
}
