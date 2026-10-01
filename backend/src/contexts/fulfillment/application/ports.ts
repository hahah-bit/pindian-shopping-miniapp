import type { FulfillmentOrder, ShipmentData } from '../domain/fulfillment-order';

/** 履约单仓储端口（Fulfillment 应用层）。sessionTx：与外层事务同连接。 */
export interface FulfillmentOrderRepository {
  insert(order: FulfillmentOrder, sessionTx?: unknown): Promise<void>;
  save(order: FulfillmentOrder, sessionTx?: unknown): Promise<void>;
  findById(id: string, sessionTx?: unknown): Promise<FulfillmentOrder | null>;
  findByIdForUpdate(id: string, sessionTx?: unknown): Promise<FulfillmentOrder | null>;
  findByOrderId(orderId: string, sessionTx?: unknown): Promise<FulfillmentOrder | null>;
  insertShipment(entity: ShipmentData, sessionTx?: unknown): Promise<void>;
  listShipments(fulfillmentOrderId: string): Promise<ShipmentData[]>;
}

/** 生成任务扫描端口（跨域只读；SQL 位于适配器）。 */
export interface FulfillmentScanPorts {
  listSuccessGroupIdsWithoutFulfillment(limit: number): Promise<string[]>;
  findGroupSnapshot(groupId: string): Promise<{ groupId: string; wholeQuantityText: string; unit: string } | null>;
  listPaidByGroup(groupId: string): Promise<Array<{
    orderId: string;
    userId: string;
    units: number;
    address: { receiver_name: string; phone: string; province: string; city: string; district: string; detail: string };
  }>>;
}
