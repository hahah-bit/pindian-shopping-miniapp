import type { PoolClient } from 'pg';
import { Order, type OrderState } from '../../../domain/order';
import type { OrderRepository } from '../../../application/order-ports';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface OrderRow {
  id: string;
  order_no: string;
  user_id: string;
  product_id: string;
  group_id: string;
  units: number;
  status: OrderState['status'];
  total_amount_fen: number;
  goods_amount_fen: number;
  service_fee_fen: number;
  tail_adjust_fen: number;
  is_final_order: boolean;
  original_price_fen: number;
  unit: string;
  whole_quantity_text: string;
  reference_quantity_text: string;
  address_receiver_name: string;
  address_phone: string;
  address_province: string;
  address_city: string;
  address_district: string;
  address_detail: string;
  reservation_expires_at: Date;
  idempotency_key: string;
  paid_at: Date | null;
  cancelled_at: Date | null;
  expired_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function orderOf(row: OrderRow): Order {
  return Order.rehydrate({
    orderId: row.id,
    orderNo: row.order_no,
    userId: row.user_id,
    productId: row.product_id,
    groupId: row.group_id,
    units: row.units,
    status: row.status,
    totalAmountFen: row.total_amount_fen,
    goodsAmountFen: row.goods_amount_fen,
    serviceFeeFen: row.service_fee_fen,
    tailAdjustFen: row.tail_adjust_fen,
    isFinalOrder: row.is_final_order,
    originalPriceFen: row.original_price_fen,
    unit: row.unit,
    wholeQuantityText: row.whole_quantity_text,
    referenceQuantityText: row.reference_quantity_text,
    addressReceiverName: row.address_receiver_name,
    addressPhone: row.address_phone,
    addressProvince: row.address_province,
    addressCity: row.address_city,
    addressDistrict: row.address_district,
    addressDetail: row.address_detail,
    reservationExpiresAt: row.reservation_expires_at,
    idempotencyKey: row.idempotency_key,
    paidAt: row.paid_at ?? null,
    cancelledAt: row.cancelled_at ?? null,
    expiredAt: row.expired_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

const COLUMNS = `id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen,
  tail_adjust_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text,
  address_receiver_name, address_phone, address_province, address_city, address_district, address_detail,
  reservation_expires_at, idempotency_key, paid_at, cancelled_at, expired_at, created_at, updated_at`;

export class PostgresOrderRepository implements OrderRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<Order | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<OrderRow>('SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2', [userId, key]);
      return rows[0] ? orderOf(rows[0]) : null;
    });
  }

  async findById(orderId: string): Promise<Order | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<OrderRow>(`SELECT ${COLUMNS} FROM orders WHERE id = $1`, [orderId]);
      return rows[0] ? orderOf(rows[0]) : null;
    });
  }

  async insert(order: Order, sessionTx?: unknown): Promise<void> {
    const s = order.state;
    await withExecutor((sessionTx as PgExecutor) ?? this.pool, (client) => client.query(
      `INSERT INTO orders (${COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
      [s.orderId, s.orderNo, s.userId, s.productId, s.groupId, s.units, s.status, s.totalAmountFen, s.goodsAmountFen, s.serviceFeeFen,
        s.tailAdjustFen, s.isFinalOrder, s.originalPriceFen, s.unit, s.wholeQuantityText, s.referenceQuantityText,
        s.addressReceiverName, s.addressPhone, s.addressProvince, s.addressCity, s.addressDistrict, s.addressDetail,
        s.reservationExpiresAt, s.idempotencyKey, s.paidAt, s.cancelledAt, s.expiredAt, s.createdAt, s.updatedAt]
    ));
  }

  async save(order: Order, sessionTx?: unknown): Promise<void> {
    const s = order.state;
    await withExecutor((sessionTx as PgExecutor) ?? this.pool, (client) => client.query(
      `UPDATE orders SET status = $2, paid_at = $3, cancelled_at = $4, expired_at = $5, updated_at = $6 WHERE id = $1`,
      [s.orderId, s.status, s.paidAt, s.cancelledAt, s.expiredAt, s.updatedAt]
    ));
  }

  /** 条件状态迁移（F016 到期任务幂等）：仅 unpaid 时生效。 */
  async transitionIfUnpaid(orderId: string, next: 'cancelled' | 'expired', now: Date, sessionTx?: unknown): Promise<boolean> {
    return withExecutor((sessionTx as PgExecutor) ?? this.pool, async (client) => {
      const column = next === 'cancelled' ? 'cancelled_at' : 'expired_at';
      const result = await client.query(
        `UPDATE orders SET status = $2, ${column} = $3, updated_at = $3 WHERE id = $1 AND status = 'unpaid'`,
        [orderId, next, now]
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async listByUser(userId: string, page: number, pageSize: number): Promise<{ items: Order[]; total: number }> {
    return this.query(async (client) => {
      const { rows: countRows } = await client.query<{ total: string }>('SELECT COUNT(*)::int4 AS total FROM orders WHERE user_id = $1', [userId]);
      const { rows } = await client.query<OrderRow>(
        `SELECT ${COLUMNS} FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [userId, pageSize, (page - 1) * pageSize]
      );
      return { items: rows.map(orderOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }

  async listAdmin(query: { status?: string | null; keyword?: string | null; page: number; pageSize: number }): Promise<{ items: Order[]; total: number }> {
    return this.query(async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.status && ['unpaid', 'paid', 'cancelled', 'expired'].includes(query.status)) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      if (query.keyword) {
        params.push(`%${query.keyword}%`);
        conditions.push('(order_no ILIKE $' + params.length + ' OR address_receiver_name ILIKE $' + params.length + ')');
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM orders ${where}`, params);
      const { rows } = await client.query<OrderRow>(
        `SELECT ${COLUMNS} FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize]
      );
      return { items: rows.map(orderOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }
}
