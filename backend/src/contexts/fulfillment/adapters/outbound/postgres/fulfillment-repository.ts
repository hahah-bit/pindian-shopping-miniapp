import type { PoolClient } from 'pg';
import { FulfillmentOrder, type FulfillmentOrderState, type ShipmentData } from '../../../domain/fulfillment-order';
import type { FulfillmentOrderRepository, FulfillmentScanPorts } from '../../../application/ports';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface FulfillmentRow {
  id: string;
  group_id: string;
  order_id: string;
  user_id: string;
  allocated_quantity_grams: number;
  unit: string;
  status: FulfillmentOrderState['status'];
  shipped_quantity_grams: number;
  receiver_name: string;
  receiver_phone: string;
  receiver_province: string;
  receiver_city: string;
  receiver_district: string;
  receiver_detail: string;
  receiver_version: number;
  completed_at: Date | null;
  completed_by: 'user' | 'admin' | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, group_id, order_id, user_id, allocated_quantity_grams, unit, status, shipped_quantity_grams,
  receiver_name, receiver_phone, receiver_province, receiver_city, receiver_district, receiver_detail, receiver_version,
  completed_at, completed_by, created_at, updated_at`;

function rowOf(row: FulfillmentRow): FulfillmentOrder {
  return FulfillmentOrder.rehydrate({
    fulfillmentOrderId: row.id,
    groupId: row.group_id,
    orderId: row.order_id,
    userId: row.user_id,
    allocatedQuantityGrams: row.allocated_quantity_grams,
    unit: row.unit,
    status: row.status,
    shippedQuantityGrams: row.shipped_quantity_grams,
    receiver: {
      name: row.receiver_name,
      phone: row.receiver_phone,
      province: row.receiver_province,
      city: row.receiver_city,
      district: row.receiver_district,
      detail: row.receiver_detail,
      version: row.receiver_version
    },
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

interface ShipmentRow {
  id: string;
  fulfillment_order_id: string;
  quantity_grams: number;
  is_reissue: boolean;
  company: string;
  tracking_no: string;
  reissue_reason: string | null;
  created_at: Date;
}

function shipmentOf(row: ShipmentRow): ShipmentData {
  return {
    shipmentId: row.id,
    fulfillmentOrderId: row.fulfillment_order_id,
    quantityGrams: row.quantity_grams,
    isReissue: row.is_reissue,
    company: row.company,
    trackingNo: row.tracking_no,
    reissueReason: row.reissue_reason,
    createdAt: row.created_at
  };
}

const SHIPMENT_COLUMNS = `id, fulfillment_order_id, quantity_grams, is_reissue, company, tracking_no, reissue_reason, created_at`;

/** 履约仓储与生成扫描端口（Postgres；跨域只读 SQL 位于此，写入仅限履约表）。 */
export class PostgresFulfillmentRepository implements FulfillmentOrderRepository, FulfillmentScanPorts {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  private async queryIn<T>(sessionTx: unknown, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (sessionTx) return withExecutor(sessionTx as PgExecutor, work);
    return this.query(work);
  }

  async insert(order: FulfillmentOrder, sessionTx?: unknown): Promise<void> {
    const s = order.state;
    await this.queryIn(sessionTx, (client) => client.query(
      `INSERT INTO fulfillment_orders (id, group_id, order_id, user_id, allocated_quantity_grams, unit, status, shipped_quantity_grams,
        receiver_name, receiver_phone, receiver_province, receiver_city, receiver_district, receiver_detail, receiver_version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [s.fulfillmentOrderId, s.groupId, s.orderId, s.userId, s.allocatedQuantityGrams, s.unit, s.status, s.shippedQuantityGrams,
        s.receiver.name, s.receiver.phone, s.receiver.province, s.receiver.city, s.receiver.district, s.receiver.detail, s.receiver.version, s.createdAt, s.updatedAt]
    ));
  }

  async save(order: FulfillmentOrder, sessionTx?: unknown): Promise<void> {
    const s = order.state;
    await this.queryIn(sessionTx, (client) => client.query(
      `UPDATE fulfillment_orders SET status = $2, shipped_quantity_grams = $3, receiver_name = $4, receiver_phone = $5,
        receiver_province = $6, receiver_city = $7, receiver_district = $8, receiver_detail = $9, receiver_version = $10,
        completed_at = $11, completed_by = $12, updated_at = $13 WHERE id = $1`,
      [s.fulfillmentOrderId, s.status, s.shippedQuantityGrams, s.receiver.name, s.receiver.phone, s.receiver.province,
        s.receiver.city, s.receiver.district, s.receiver.detail, s.receiver.version, s.completedAt, s.completedBy, s.updatedAt]
    ));
  }

  private mapById(rows: FulfillmentRow[]): FulfillmentOrder | null {
    return rows[0] ? rowOf(rows[0]) : null;
  }

  async findById(id: string, sessionTx?: unknown): Promise<FulfillmentOrder | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<FulfillmentRow>(`SELECT ${COLUMNS} FROM fulfillment_orders WHERE id = $1`, [id]);
      return this.mapById(rows);
    });
  }

  async findByIdForUpdate(id: string, sessionTx?: unknown): Promise<FulfillmentOrder | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<FulfillmentRow>(`SELECT ${COLUMNS} FROM fulfillment_orders WHERE id = $1 FOR UPDATE`, [id]);
      return this.mapById(rows);
    });
  }

  async findByOrderId(orderId: string, sessionTx?: unknown): Promise<FulfillmentOrder | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<FulfillmentRow>(`SELECT ${COLUMNS} FROM fulfillment_orders WHERE order_id = $1`, [orderId]);
      return this.mapById(rows);
    });
  }

  async insertShipment(entity: ShipmentData, sessionTx?: unknown): Promise<void> {
    await this.queryIn(sessionTx, (client) => client.query(
      `INSERT INTO shipments (id, fulfillment_order_id, quantity_grams, is_reissue, company, tracking_no, reissue_reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [entity.shipmentId, entity.fulfillmentOrderId, entity.quantityGrams, entity.isReissue, entity.company, entity.trackingNo, entity.reissueReason, entity.createdAt]
    ));
  }

  async listShipments(fulfillmentOrderId: string): Promise<ShipmentData[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<ShipmentRow>(
        `SELECT ${SHIPMENT_COLUMNS} FROM shipments WHERE fulfillment_order_id = $1 ORDER BY created_at ASC, id ASC`,
        [fulfillmentOrderId]
      );
      return rows.map(shipmentOf);
    });
  }

  // ---- 生成扫描端口（跨域只读） ----

  async listSuccessGroupIdsWithoutFulfillment(limit: number): Promise<string[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT g.id FROM groups g
         WHERE g.status = 'success'
         AND EXISTS (SELECT 1 FROM orders o WHERE o.group_id = g.id AND o.status = 'paid')
         AND NOT EXISTS (SELECT 1 FROM fulfillment_orders f WHERE f.group_id = g.id)
         ORDER BY g.updated_at ASC LIMIT $1`,
        [limit]
      );
      return rows.map((r) => r.id);
    });
  }

  async findGroupSnapshot(groupId: string): Promise<{ groupId: string; wholeQuantityText: string; unit: string } | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<{ id: string; snapshot: { wholeQuantityText?: string; unit?: string } }>(
        `SELECT id, sale_policy_snapshot AS snapshot FROM groups WHERE id = $1 AND status = 'success'`,
        [groupId]
      );
      const row = rows[0];
      if (!row) return null;
      return { groupId: row.id, wholeQuantityText: row.snapshot?.wholeQuantityText ?? '', unit: row.snapshot?.unit ?? '件' };
    });
  }

  async listPaidByGroup(groupId: string): Promise<Array<{
    orderId: string;
    userId: string;
    units: number;
    address: { receiver_name: string; phone: string; province: string; city: string; district: string; detail: string };
  }>> {
    return this.query(async (client) => {
      const { rows } = await client.query<{
        id: string; user_id: string; units: number;
        address_receiver_name: string; address_phone: string; address_province: string; address_city: string; address_district: string; address_detail: string;
      }>(
        `SELECT id, user_id, units, address_receiver_name, address_phone, address_province, address_city, address_district, address_detail
         FROM orders WHERE group_id = $1 AND status = 'paid' ORDER BY created_at ASC, id ASC`,
        [groupId]
      );
      return rows.map((row) => ({
        orderId: row.id,
        userId: row.user_id,
        units: row.units,
        address: {
          receiver_name: row.address_receiver_name,
          phone: row.address_phone,
          province: row.address_province,
          city: row.address_city,
          district: row.address_district,
          detail: row.address_detail
        }
      }));
    });
  }
}
