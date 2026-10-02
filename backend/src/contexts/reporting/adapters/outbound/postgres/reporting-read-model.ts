import type { Pool, PoolClient } from 'pg';
import type { ReportingOverviewMetrics, ReportingProductMetrics, ReportingCsMetrics, ResolvedDay } from '../../../domain/metrics';
import type { ReportingReadModel } from '../../../application/reporting-queries';

type Row = Record<string, string | number | null>;

/** 「全额成功退款」判定：存在 succeeded 退款且金额 ≥ 支付金额（T006/T008 退款均为单笔全额语义）。 */
const VALID_PAID_GUARD = `NOT EXISTS (
  SELECT 1 FROM payments p JOIN refunds r ON r.payment_id = p.id
  WHERE p.order_id = o.id AND r.status = 'succeeded' AND r.amount_fen >= p.amount_fen
)`;

const AGENT_VISIBLE_REPLY = `sender = 'agent' AND internal = false`;

function roundMinutes(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(Number(value));
}

function singleRow(rows: Row[]): Row {
  const row = rows[0];
  if (!row) throw new Error('统计查询未返回聚合行');
  return row;
}

/** 运营看板只读投影：跨上下文事实表的只读 SQL 聚合（DDD 读模型），不写任何业务表。 */
export class PostgresReportingReadModel implements ReportingReadModel {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async withClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await work(client);
    } finally {
      client.release();
    }
  }

  async overviewSnapshot(day: ResolvedDay): Promise<{ overview: ReportingOverviewMetrics; product: ReportingProductMetrics }> {
    return this.withClient(async (client) => {
      const base = await client.query<Row>(
        `SELECT
          (SELECT COUNT(*) FROM products) AS total_products,
          (SELECT COUNT(*) FROM products WHERE status = 'on_shelf') AS on_shelf_products,
          (SELECT COUNT(*) FROM groups WHERE status = 'open') AS open_groups,
          (SELECT COUNT(*) FROM groups WHERE status = 'success') AS success_groups,
          (SELECT COUNT(*) FROM groups WHERE status = 'failed') AS failed_groups,
          (SELECT COUNT(*) FROM orders WHERE created_at >= $1 AND created_at < $2) AS today_orders,
          (SELECT COALESCE(SUM(total_amount_fen), 0) FROM orders WHERE status = 'paid' AND paid_at >= $1 AND paid_at < $2) AS today_paid_fen,
          (SELECT COALESCE(SUM(o.service_fee_fen), 0) FROM orders o WHERE o.status = 'paid' AND ${VALID_PAID_GUARD}) AS valid_service_fee_fen,
          (SELECT COALESCE(SUM(amount_fen), 0) FROM refunds WHERE status = 'requested') AS refund_requested_fen,
          (SELECT COALESCE(SUM(amount_fen), 0) FROM refunds WHERE status IN ('submitted', 'processing')) AS refund_accepted_fen,
          (SELECT COALESCE(SUM(amount_fen), 0) FROM refunds WHERE status = 'succeeded') AS refund_succeeded_fen,
          (SELECT COUNT(*) FROM fulfillment_orders WHERE status = 'pending_shipment') AS pending_shipment_count,
          (SELECT COUNT(*) FROM cs_conversations WHERE status = 'queued') AS cs_pending_count,
          (SELECT COALESCE(SUM(available_whole_items), 0) FROM stocks) AS stock_whole_items,
          (SELECT COUNT(*) FROM groups) AS created_groups,
          (SELECT COUNT(*) FROM groups WHERE status IN ('success', 'failed')) AS closed_groups,
          (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status = 'paid') AS paid_user_count,
          (SELECT AVG(EXTRACT(EPOCH FROM (mx.pa - g.created_at)) / 60)
             FROM groups g
             JOIN (SELECT group_id, MAX(paid_at) AS pa FROM orders WHERE status = 'paid' AND paid_at IS NOT NULL GROUP BY group_id) mx ON mx.group_id = g.id
            WHERE g.status = 'success') AS avg_group_minutes,
          (SELECT COALESCE(SUM(o.goods_amount_fen), 0) FROM orders o WHERE o.status = 'paid' AND ${VALID_PAID_GUARD}) AS valid_goods_fen`,
        [day.startUtc, day.endUtc]
      );
      const row = singleRow(base.rows);
      const successGroups = Number(row.success_groups);
      const closedGroups = Number(row.closed_groups);
      const overview: ReportingOverviewMetrics = {
        totalProducts: Number(row.total_products),
        onShelfProducts: Number(row.on_shelf_products),
        openGroups: Number(row.open_groups),
        successGroups,
        failedGroups: Number(row.failed_groups),
        todayOrders: Number(row.today_orders),
        todayPaidAmountFen: Number(row.today_paid_fen),
        serviceFeeIncomeFen: Number(row.valid_service_fee_fen),
        pendingRefundAmountFen: Number(row.refund_requested_fen) + Number(row.refund_accepted_fen),
        pendingShipmentCount: Number(row.pending_shipment_count),
        csPendingCount: Number(row.cs_pending_count),
        refundRequestedFen: Number(row.refund_requested_fen),
        refundAcceptedFen: Number(row.refund_accepted_fen),
        refundSucceededFen: Number(row.refund_succeeded_fen)
      };
      const product: ReportingProductMetrics = {
        stockWholeItems: Number(row.stock_whole_items),
        createdGroups: Number(row.created_groups),
        successGroups,
        openGroups: Number(row.open_groups),
        paidUserCount: Number(row.paid_user_count),
        successRate: closedGroups === 0 ? null : Math.round((successGroups / closedGroups) * 10_000) / 10_000,
        avgGroupDurationMinutes: roundMinutes(row.avg_group_minutes),
        goodsAmountFen: Number(row.valid_goods_fen),
        serviceFeeAmountFen: Number(row.valid_service_fee_fen),
        refundedAmountFen: Number(row.refund_succeeded_fen)
      };
      return { overview, product };
    });
  }

  async csSnapshot(day: ResolvedDay, overdueThresholdMinutes: number): Promise<ReportingCsMetrics> {
    return this.withClient(async (client) => {
      const base = await client.query<Row>(
        `SELECT
          (SELECT COUNT(DISTINCT user_id) FROM cs_conversations WHERE created_at >= $1 AND created_at < $2) AS today_consult_users,
          (SELECT COUNT(*) FROM cs_conversations WHERE status = 'queued') AS queued_count,
          (SELECT COUNT(*) FROM cs_agent_presence WHERE heartbeat_at > now() - interval '60 seconds') AS online_agents,
          (SELECT AVG(EXTRACT(EPOCH FROM (fr.first_at - c.created_at)) / 60)
             FROM cs_conversations c
             JOIN (SELECT conversation_id, MIN(created_at) AS first_at FROM cs_messages WHERE ${AGENT_VISIBLE_REPLY} GROUP BY conversation_id) fr ON fr.conversation_id = c.id
            WHERE c.created_at >= $1 AND c.created_at < $2) AS avg_first_response_minutes,
          (SELECT AVG(EXTRACT(EPOCH FROM (c.updated_at - c.created_at)) / 60) FROM cs_conversations c WHERE c.status IN ('ended', 'converted')) AS avg_session_minutes,
          (SELECT (SELECT COUNT(*) FROM cs_conversations WHERE status = 'queued')
                 + (SELECT COUNT(*) FROM cs_conversations c WHERE c.status = 'active'
                      AND NOT EXISTS (SELECT 1 FROM cs_messages m WHERE m.conversation_id = c.id AND ${AGENT_VISIBLE_REPLY}))) AS unhandled_count,
          (SELECT COUNT(*) FROM after_sales_tickets) AS ticket_count,
          (SELECT COUNT(*) FROM after_sales_tickets WHERE status IN ('resolved', 'closed')) AS ticket_resolved_count,
          (SELECT COUNT(*) FROM cs_conversations c
            WHERE c.status IN ('queued', 'active') AND c.created_at < now() - make_interval(mins => $3)
              AND NOT EXISTS (SELECT 1 FROM cs_messages m WHERE m.conversation_id = c.id AND ${AGENT_VISIBLE_REPLY})) AS overdue_count`,
        [day.startUtc, day.endUtc, overdueThresholdMinutes]
      );
      const types = await client.query<Row>(`SELECT type, COUNT(*)::int AS count FROM after_sales_tickets GROUP BY type ORDER BY type`);
      const load = await client.query<Row>(
        `SELECT c.assigned_agent_id, a.display_name, COUNT(*)::int AS conversations
           FROM cs_conversations c JOIN admins a ON a.id = c.assigned_agent_id
          WHERE c.assigned_agent_id IS NOT NULL
          GROUP BY c.assigned_agent_id, a.display_name ORDER BY c.assigned_agent_id`
      );
      const row = singleRow(base.rows);
      const ticketCount = Number(row.ticket_count);
      const ticketResolved = Number(row.ticket_resolved_count);
      return {
        todayConsultUsers: Number(row.today_consult_users),
        queuedCount: Number(row.queued_count),
        onlineAgentCount: Number(row.online_agents),
        avgFirstResponseMinutes: roundMinutes(row.avg_first_response_minutes),
        avgSessionDurationMinutes: roundMinutes(row.avg_session_minutes),
        unhandledCount: Number(row.unhandled_count),
        ticketCount,
        ticketResolveRate: ticketCount === 0 ? null : Math.round((ticketResolved / ticketCount) * 10_000) / 10_000,
        ticketTypeStats: types.rows.map((r) => ({ type: String(r.type), count: Number(r.count) })),
        agentLoad: load.rows.map((r) => ({ agentId: String(r.assigned_agent_id), displayName: String(r.display_name), conversations: Number(r.conversations) })),
        overdueFirstResponseCount: Number(row.overdue_count)
      };
    });
  }
}
