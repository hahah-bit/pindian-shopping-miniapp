import { ApplicationError } from '../../../shared/kernel';
import type { OrderRepository } from '../../ordering/application/order-ports';
import type { PaymentRepository } from './ports';
import type { MiniOrderView } from '@pindian/contracts';

/** 前端支付结果查询：以后端订单状态为准（不信任前端支付提示）。 */
export class PaymentQueryResult {
  constructor(private readonly deps: { payments: PaymentRepository; orders: OrderRepository }) {}

  async execute(input: { orderId: unknown; userId: unknown }): Promise<MiniOrderView> {
    const orderId = typeof input.orderId === 'string' ? input.orderId : '';
    const userId = typeof input.userId === 'string' ? input.userId : '';
    const order = await this.deps.orders.findById(orderId);
    if (!order || order.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
    const s = order.state;
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
      paymentNotice: s.status === 'unpaid' ? '微信支付暂未开放，开放后可支付该订单' : '',
      createdAt: s.createdAt.toISOString()
    };
  }
}
