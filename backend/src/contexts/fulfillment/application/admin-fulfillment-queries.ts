import { withExecutor, type PgExecutor } from '../../../adapters-shared/pg-client';

export interface AdminFulfillmentGroupSummary {
  groupId: string;
  productId: string;
  productName: string;
  succeededAt: string;
  total: number;
  pending: number;
  partially: number;
  shipped: number;
  completed: number;
}

export interface AdminFulfillmentDetail {
  fulfillmentOrderId: string;
  orderId: string;
  orderNo: string;
  nickname: string;
  units: number;
  allocatedQuantityGrams: number;
  allocatedQuantityText: string;
  status: string;
  receiver: { name: string; /** 仅 unmasked 选项（导出）携带原文，否则为空串 */ phone: string; phoneMasked: string; province: string; city: string; district: string; detail: string; version: number };
  shipments: Array<{ id: string; quantityGrams: number; quantityText: string; isReissue: boolean; reissueReason: string | null; company: string; trackingNo: string; shippedAt: string }>;
}

/** 后台履约查询投影（只读；电话脱敏）。 */
export class AdminFulfillmentQueries {
  constructor(private readonly pool: PgExecutor, private readonly nicknameOf: (userId: string) => Promise<string>) {}

  async listGroups(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: AdminFulfillmentGroupSummary[]; total: number }> {
    return withExecutor(this.pool, async (client) => {
      const validStatus = ['pending_shipment', 'partially_shipped', 'shipped', 'completed'].includes(query.status ?? '') ? query.status : null;
      // status 归入口径：组内全部履约单处于同一状态才归入该状态
      const having = validStatus
        ? `HAVING COUNT(*) FILTER (WHERE f.status = $1) = COUNT(*)`
        : '';
      const params: unknown[] = [];
      if (validStatus) params.push(validStatus);
      const where = validStatus ? `WHERE g.status = 'success'` : `WHERE g.status = 'success'`;
      const { rows: totalRows } = await client.query<{ total: string }>(
        `SELECT COUNT(*)::int AS total FROM (
           SELECT g.id FROM groups g
           JOIN fulfillment_orders f ON f.group_id = g.id
           ${where}
           GROUP BY g.id ${having}
         ) t`,
        params
      );
      const pageParams = [...params, query.pageSize, (query.page - 1) * query.pageSize];
      const { rows } = await client.query<{
        group_id: string; product_id: string; product_name: string; succeeded_at: Date;
        total: number; pending: number; partially: number; shipped: number; completed: number;
      }>(
        `SELECT g.id AS group_id, g.product_id, p.name AS product_name, g.updated_at AS succeeded_at,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE f.status = 'pending_shipment')::int AS pending,
           COUNT(*) FILTER (WHERE f.status = 'partially_shipped')::int AS partially,
           COUNT(*) FILTER (WHERE f.status = 'shipped')::int AS shipped,
           COUNT(*) FILTER (WHERE f.status = 'completed')::int AS completed
         FROM groups g
         JOIN fulfillment_orders f ON f.group_id = g.id
         LEFT JOIN products p ON p.id = g.product_id
         ${where}
         GROUP BY g.id, g.product_id, p.name, g.updated_at
         ${having}
         ORDER BY g.updated_at ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        pageParams
      );
      return {
        items: rows.map((row) => ({
          groupId: row.group_id,
          productId: row.product_id,
          productName: row.product_name ?? '',
          succeededAt: row.succeeded_at.toISOString(),
          total: row.total,
          pending: row.pending,
          partially: row.partially,
          shipped: row.shipped,
          completed: row.completed
        })),
        total: Number(totalRows[0]?.total ?? 0)
      };
    });
  }

  async groupDetail(groupId: string, options: { unmasked?: boolean } = {}): Promise<{ groupId: string; items: AdminFulfillmentDetail[] } | null> {
    return withExecutor(this.pool, async (client) => {
      const { rows: groupRows } = await client.query<{ id: string }>(
        `SELECT id FROM groups WHERE id = $1 AND status = 'success'`,
        [groupId]
      );
      if (!groupRows[0]) return null;
      const { rows } = await client.query<{
        id: string; order_id: string; order_no: string; user_id: string; units: number;
        allocated_quantity_grams: number; unit: string; status: string;
        receiver_name: string; receiver_phone: string; receiver_province: string; receiver_city: string; receiver_district: string; receiver_detail: string; receiver_version: number;
      }>(
        `SELECT f.id, f.order_id, o.order_no, f.user_id, o.units, f.allocated_quantity_grams, f.unit, f.status,
           f.receiver_name, f.receiver_phone, f.receiver_province, f.receiver_city, f.receiver_district, f.receiver_detail, f.receiver_version
         FROM fulfillment_orders f
         JOIN orders o ON o.id = f.order_id
         WHERE f.group_id = $1
         ORDER BY o.created_at ASC, f.id ASC`,
        [groupId]
      );
      const { rows: shipmentRows } = await client.query<{
        id: string; fulfillment_order_id: string; quantity_grams: number; is_reissue: boolean; reissue_reason: string | null;
        company: string; tracking_no: string; created_at: Date;
      }>(
        `SELECT id, fulfillment_order_id, quantity_grams, is_reissue, reissue_reason, company, tracking_no, created_at
         FROM shipments WHERE fulfillment_order_id IN (SELECT id FROM fulfillment_orders WHERE group_id = $1)
         ORDER BY created_at ASC, id ASC`,
        [groupId]
      );
      const shipmentsByFid = new Map<string, AdminFulfillmentDetail['shipments']>();
      for (const row of shipmentRows) {
        const list = shipmentsByFid.get(row.fulfillment_order_id) ?? [];
        list.push({
          id: row.id,
          quantityGrams: row.quantity_grams,
          quantityText: (row.quantity_grams / 500).toFixed(3),
          isReissue: row.is_reissue,
          reissueReason: row.reissue_reason,
          company: row.company,
          trackingNo: row.tracking_no,
          shippedAt: row.created_at.toISOString()
        });
        shipmentsByFid.set(row.fulfillment_order_id, list);
      }
      const items: AdminFulfillmentDetail[] = [];
      for (const row of rows) {
        const nickname = await this.nicknameOf(row.user_id);
        items.push({
          fulfillmentOrderId: row.id,
          orderId: row.order_id,
          orderNo: row.order_no,
          nickname,
          units: row.units,
          allocatedQuantityGrams: row.allocated_quantity_grams,
          allocatedQuantityText: (row.allocated_quantity_grams / 500).toFixed(3),
          status: row.status,
          receiver: {
            name: row.receiver_name,
            phone: row.receiver_phone,
            phoneMasked: options.unmasked ? row.receiver_phone : maskPhoneOf(row.receiver_phone),
            province: row.receiver_province,
            city: row.receiver_city,
            district: row.receiver_district,
            detail: row.receiver_detail,
            version: row.receiver_version
          },
          shipments: shipmentsByFid.get(row.id) ?? []
        });
      }
      return { groupId, items };
    });
  }

  /** 发货单导出行（收货电话明文——面单必需；调用方必须写 fulfillment.export 审计）。 */
  async groupExportRows(groupId: string): Promise<Array<{
    fulfillmentOrderId: string; orderNo: string; nickname: string; allocatedQuantityGrams: number;
    receiverName: string; receiverPhone: string; province: string; city: string; district: string; detail: string;
    status: string; shipments: Array<{ company: string; trackingNo: string; quantityGrams: number; isReissue: boolean; shippedAt: string }>;
  }> | null> {
    const detail = await this.groupDetail(groupId, { unmasked: true });
    if (!detail) return null;
    return detail.items.map((item) => ({
      fulfillmentOrderId: item.fulfillmentOrderId,
      orderNo: item.orderNo,
      nickname: item.nickname,
      allocatedQuantityGrams: item.allocatedQuantityGrams,
      receiverName: item.receiver.name,
      receiverPhone: item.receiver.phone,
      province: item.receiver.province,
      city: item.receiver.city,
      district: item.receiver.district,
      detail: item.receiver.detail,
      status: item.status,
      shipments: item.shipments.map((s) => ({ company: s.company, trackingNo: s.trackingNo, quantityGrams: s.quantityGrams, isReissue: s.isReissue, shippedAt: s.shippedAt }))
    }));
  }
}

function maskPhoneOf(phone: string): string {
  if (/^1[3-9]\d{9}$/.test(phone)) return `${phone.slice(0, 3)}****${phone.slice(7)}`;
  if (phone.length >= 4) return `****${phone.slice(-4)}`;
  return '****';
}
