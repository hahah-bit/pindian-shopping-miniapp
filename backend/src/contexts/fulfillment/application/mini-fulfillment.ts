import { ApplicationError, type Clock } from '../../../shared/kernel';
import { FulfillmentOrder } from '../domain/fulfillment-order';
import { gramsToJinText } from '../domain/quantity-allocation';

export interface MiniFulfillmentView {
  fulfillmentOrderId: string;
  status: 'pending_shipment' | 'partially_shipped' | 'shipped' | 'completed';
  allocatedQuantityGrams: number;
  allocatedQuantityText: string;
  unit: string;
  shipments: Array<{ id: string; quantityGrams: number; quantityText: string; isReissue: boolean; reissueReason: string | null; company: string; trackingNo: string; shippedAt: string }>;
  receiverSnapshot: { name: string; phone: string; province: string; city: string; district: string; detail: string };
  completedBy: 'user' | 'admin' | null;
  completedAt: string | null;
}

export interface MiniFulfillmentResult {
  fulfillmentOrder: MiniFulfillmentView | null;
  groupSummary: { groupId: string; status: string } | null;
}

/** 小程序履约进度（F030）：仅本人订单；未生成返回空态。 */
export class MiniFulfillmentQueries {
  constructor(private readonly deps: {
    orders: { findById(orderId: string): Promise<{ state: { userId: string; groupId: string } } | null> };
    fulfillmentOrders: { findByOrderId(orderId: string): Promise<FulfillmentOrder | null> };
    shipments: { listShipments(fulfillmentOrderId: string): Promise<Array<{ shipmentId: string; quantityGrams: number; isReissue: boolean; reissueReason: string | null; company: string; trackingNo: string; createdAt: Date }>> };
    groups: { findGroupStatus(groupId: string): Promise<{ groupId: string; status: string } | null> };
  }) {}

  async execute(input: { orderId: unknown; userId: unknown }): Promise<MiniFulfillmentResult> {
    const orderId = typeof input.orderId === 'string' ? input.orderId : '';
    const userId = typeof input.userId === 'string' ? input.userId : '';
    const order = await this.deps.orders.findById(orderId);
    if (!order || order.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
    const fulfillment = await this.deps.fulfillmentOrders.findByOrderId(orderId);
    const groupStatus = await this.deps.groups.findGroupStatus(order.state.groupId);
    if (!fulfillment) {
      return { fulfillmentOrder: null, groupSummary: groupStatus ? { groupId: groupStatus.groupId, status: groupStatus.status } : null };
    }
    const shipments = await this.deps.shipments.listShipments(fulfillment.state.fulfillmentOrderId);
    const s = fulfillment.state;
    return {
      fulfillmentOrder: {
        fulfillmentOrderId: s.fulfillmentOrderId,
        status: s.status,
        allocatedQuantityGrams: s.allocatedQuantityGrams,
        allocatedQuantityText: gramsToJinText(s.allocatedQuantityGrams),
        unit: s.unit,
        shipments: shipments.map((shipment) => ({
          id: shipment.shipmentId,
          quantityGrams: shipment.quantityGrams,
          quantityText: gramsToJinText(shipment.quantityGrams),
          isReissue: shipment.isReissue,
          reissueReason: shipment.reissueReason,
          company: shipment.company,
          trackingNo: shipment.trackingNo,
          shippedAt: shipment.createdAt.toISOString()
        })),
        receiverSnapshot: {
          name: s.receiver.name, phone: s.receiver.phone, province: s.receiver.province,
          city: s.receiver.city, district: s.receiver.district, detail: s.receiver.detail
        },
        completedBy: s.completedBy,
        completedAt: s.completedAt ? s.completedAt.toISOString() : null
      },
      groupSummary: groupStatus ? { groupId: groupStatus.groupId, status: groupStatus.status } : null
    };
  }
}

/** 用户确认收货（F030，D014）：本人 + shipped；终态幂等。 */
export class ConfirmReceiptUseCase {
  constructor(private readonly deps: {
    fulfillmentOrders: { findByIdForUpdate(id: string, sessionTx?: unknown): Promise<FulfillmentOrder | null>; save(order: FulfillmentOrder, sessionTx?: unknown): Promise<void> };
    runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
    clock: Clock;
  }) {}

  async execute(input: { fulfillmentId: unknown; userId: unknown }): Promise<{ status: string; completedBy: string | null }> {
    const fulfillmentId = typeof input.fulfillmentId === 'string' ? input.fulfillmentId : '';
    const userId = typeof input.userId === 'string' ? input.userId : '';
    const result = await this.deps.runner.run(async (sessionTx) => {
      const fulfillment = await this.deps.fulfillmentOrders.findByIdForUpdate(fulfillmentId, sessionTx);
      if (!fulfillment || fulfillment.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '履约单不存在');
      const completed = fulfillment.markCompleted('user', this.deps.clock.now());
      if (completed !== fulfillment) await this.deps.fulfillmentOrders.save(completed, sessionTx);
      return completed;
    });
    return { status: result.state.status, completedBy: result.state.completedBy };
  }
}
