import { ApplicationError } from '../../../shared/kernel';

export type FulfillmentStatus = 'pending_shipment' | 'partially_shipped' | 'shipped' | 'completed';

export interface ReceiverSnapshot {
  name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  version: number;
}

export interface ShipmentData {
  shipmentId: string;
  fulfillmentOrderId: string;
  quantityGrams: number;
  isReissue: boolean;
  company: string;
  trackingNo: string;
  reissueReason: string | null;
  createdAt: Date;
}

export interface FulfillmentOrderState {
  fulfillmentOrderId: string;
  groupId: string;
  orderId: string;
  userId: string;
  allocatedQuantityGrams: number;
  unit: string;
  status: FulfillmentStatus;
  shippedQuantityGrams: number;
  receiver: ReceiverSnapshot;
  completedAt: Date | null;
  completedBy: 'user' | 'admin' | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewShipmentInput {
  quantityGrams: number;
  isReissue: boolean;
  company: string;
  trackingNo: string;
  reissueReason?: string;
}

/**
 * 履约单聚合（T007）。
 * 不变量：分配数量不可变；Σ非补发包裹 ≤ 分配数量且 = 时状态 shipped；
 * completed 仅自 shipped、终态；收货快照发货后锁定；补发不计入发货进度。
 */
export class FulfillmentOrder {
  private constructor(readonly state: FulfillmentOrderState) {}

  static rehydrate(state: FulfillmentOrderState): FulfillmentOrder {
    return new FulfillmentOrder({ ...state, receiver: { ...state.receiver } });
  }

  static create(input: {
    fulfillmentOrderId?: string;
    groupId: string;
    orderId: string;
    userId: string;
    allocatedQuantityGrams: number;
    unit: string;
    receiver: { name: string; phone: string; province: string; city: string; district: string; detail: string };
    now: Date;
  }): FulfillmentOrder {
    if (!Number.isInteger(input.allocatedQuantityGrams) || input.allocatedQuantityGrams <= 0) {
      throw new ApplicationError('VALIDATION_FAILED', '分配数量必须为正整数克');
    }
    return new FulfillmentOrder({
      fulfillmentOrderId: input.fulfillmentOrderId ?? crypto.randomUUID(),
      groupId: input.groupId,
      orderId: input.orderId,
      userId: input.userId,
      allocatedQuantityGrams: input.allocatedQuantityGrams,
      unit: input.unit,
      status: 'pending_shipment',
      shippedQuantityGrams: 0,
      receiver: { ...input.receiver, version: 1 },
      completedAt: null,
      completedBy: null,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  /**
   * 发货/补发：返回新聚合（调用方在同一事务内持久化 shipment 实体）。
   * R06（D013 已确认）：补发在任意状态（含 completed）允许，**不改变主发货进度与状态**
   * （状态仅由非补发 Σ数量推导）；非补发发货在 completed 下拒绝。
   */
  addShipment(shipment: { shipmentId?: string; fulfillmentOrderId?: string } & NewShipmentInput, now: Date): { order: FulfillmentOrder; entity: ShipmentData } {
    if (this.state.status === 'completed' && !shipment.isReissue) throw new ApplicationError('FULFILLMENT_NOT_SHIPPABLE', '履约已完成，不能发货');
    if (!Number.isInteger(shipment.quantityGrams) || shipment.quantityGrams <= 0) throw new ApplicationError('VALIDATION_FAILED', '发货数量必须为正整数克');
    if (shipment.isReissue && !(shipment.reissueReason ?? '').trim()) throw new ApplicationError('VALIDATION_FAILED', '补发必须填写原因');
    if (!shipment.isReissue && this.state.shippedQuantityGrams + shipment.quantityGrams > this.state.allocatedQuantityGrams) {
      throw new ApplicationError('QUANTITY_EXCEEDS_ALLOCATION', '发货数量超出分配数量（超发）');
    }
    if (shipment.isReissue) {
      return {
        order: new FulfillmentOrder({ ...this.state, updatedAt: now }),
        entity: {
          shipmentId: shipment.shipmentId ?? crypto.randomUUID(),
          fulfillmentOrderId: this.state.fulfillmentOrderId,
          quantityGrams: shipment.quantityGrams,
          isReissue: true,
          company: shipment.company,
          trackingNo: shipment.trackingNo,
          reissueReason: (shipment.reissueReason ?? '').trim(),
          createdAt: now
        }
      };
    }
    const shippedQuantityGrams = this.state.shippedQuantityGrams + shipment.quantityGrams;
    const status: FulfillmentStatus = shippedQuantityGrams === this.state.allocatedQuantityGrams ? 'shipped' : 'partially_shipped';
    const entity: ShipmentData = {
      shipmentId: shipment.shipmentId ?? crypto.randomUUID(),
      fulfillmentOrderId: this.state.fulfillmentOrderId,
      quantityGrams: shipment.quantityGrams,
      isReissue: shipment.isReissue,
      company: shipment.company,
      trackingNo: shipment.trackingNo,
      reissueReason: shipment.isReissue ? (shipment.reissueReason ?? '').trim() : null,
      createdAt: now
    };
    return {
      order: new FulfillmentOrder({ ...this.state, shippedQuantityGrams, status, updatedAt: now }),
      entity
    };
  }

  /** 发货前管理员修改收货快照：版本递增；发货后锁定。 */
  updateReceiver(receiver: { name: string; phone: string; province: string; city: string; district: string; detail: string }, now: Date): FulfillmentOrder {
    if (this.state.shippedQuantityGrams > 0) throw new ApplicationError('RECEIVER_LOCKED', '已进入发货，收货信息已锁定');
    return new FulfillmentOrder({
      ...this.state,
      receiver: { ...receiver, version: this.state.receiver.version + 1 },
      updatedAt: now
    });
  }

  /** 完成：仅 shipped；终态；completed_by 区分用户确认与管理员标记。 */
  markCompleted(by: 'user' | 'admin', now: Date): FulfillmentOrder {
    if (this.state.status === 'completed') return this; // 终态幂等
    if (this.state.status !== 'shipped') throw new ApplicationError('FULFILLMENT_NOT_SHIPPABLE', '履约单尚未全部发货，不能完成');
    return new FulfillmentOrder({ ...this.state, status: 'completed', completedAt: now, completedBy: by, updatedAt: now });
  }
}
