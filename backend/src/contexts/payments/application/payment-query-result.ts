import { ApplicationError } from '../../../shared/kernel';
import type { OrderRepository } from '../../ordering/application/order-ports';
import type { PaymentRepository } from './ports';
import type { MiniOrderView } from '@pindian/contracts';

export interface PaymentQueryResultDeps {
  payments: PaymentRepository;
  orders: OrderRepository;
  payConfig: { configured: boolean };
  /** R7（复验）：刷新=后端查单。processing/unknown 时主动查询渠道并走确认流程。 */
  channel?: { queryOrderByOutTradeNo(outTradeNo: string): Promise<{ tradeState: string; transactionId?: string; payerTotal?: number }> };
  confirm?: { execute(input: { channelFact: { outTradeNo: string; channelTransactionId: string; payerTotal: number }; source: 'query' }): Promise<boolean> };
}

/**
 * 前端支付结果查询（刷新）：以后端订单状态为准（不信任前端支付提示）。
 * 支付仍在途（processing/unknown）时主动向渠道查单并走确认流程（与查询补偿同语义，D010）；
 * 已成功订单直接返回本地事实，不再访问渠道。
 */
export class PaymentQueryResult {
  constructor(private readonly deps: PaymentQueryResultDeps) {}

  async execute(input: { orderId: unknown; userId: unknown }): Promise<MiniOrderView> {
    const orderId = typeof input.orderId === 'string' ? input.orderId : '';
    const userId = typeof input.userId === 'string' ? input.userId : '';
    const order = await this.deps.orders.findById(orderId);
    if (!order || order.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');

    if (this.deps.channel && this.deps.confirm) {
      const payment = await this.deps.payments.findByOrderId(orderId);
      if (payment && (payment.state.status === 'processing' || payment.state.status === 'unknown')) {
        try {
          const result = await this.deps.channel.queryOrderByOutTradeNo(orderId);
          if (result.tradeState === 'SUCCESS' && result.transactionId) {
            await this.deps.confirm.execute({
              channelFact: { outTradeNo: orderId, channelTransactionId: result.transactionId, payerTotal: result.payerTotal ?? payment.state.amountFen },
              source: 'query'
            });
          }
        } catch (error) {
          // 渠道查询失败不阻断刷新：返回本地事实（补偿任务会继续兜底）
          console.error('[payment-result] 刷新查单失败', orderId, error instanceof Error ? error.message : error);
        }
      }
    }

    const fresh = await this.deps.orders.findById(orderId);
    const s = (fresh ?? order).state;
    return {
      id: s.orderId,
      orderNo: s.orderNo,
      status: s.status,
      units: s.units,
      productId: s.productId,
      groupId: s.groupId,
      quote: {
        totalAmountFen: s.totalAmountFen,
        goodsAmountFen: s.goodsAmountFen,
        serviceFeeFen: s.serviceFeeFen,
        tailAdjustFen: s.tailAdjustFen,
        isFinalOrder: s.isFinalOrder
      },
      productSnapshot: {
        originalPriceFen: s.originalPriceFen,
        unit: s.unit,
        wholeQuantityText: s.wholeQuantityText,
        referenceQuantityText: s.referenceQuantityText
      },
      addressSnapshot: {
        receiverName: s.addressReceiverName,
        phone: s.addressPhone,
        province: s.addressProvince,
        city: s.addressCity,
        district: s.addressDistrict,
        detail: s.addressDetail
      },
      groupSummary: null,
      reservationExpiresAt: s.reservationExpiresAt.toISOString(),
      paymentNotice: s.status === 'unpaid' && !this.deps.payConfig.configured ? '微信支付暂未开放，开放后可支付该订单' : '',
      createdAt: s.createdAt.toISOString()
    };
  }
}
