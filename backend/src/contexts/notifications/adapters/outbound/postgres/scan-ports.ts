import type { Pool } from 'pg';
import type { CsTimeoutScanPort, BusinessEventScanPort } from '../../../application/ports';

/** 客服超时与业务事件补抓的只读扫描（D022/D026）：只读 SQL，不写任何业务表。 */
export class PostgresNotificationScanPort implements CsTimeoutScanPort, BusinessEventScanPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findOverdueConversations(thresholdMinutes: number, limit: number): Promise<Array<{ conversationId: string; userId: string; createdAt: Date }>> {
    const rows = await this.pool.query(
      `SELECT c.id, c.user_id, c.created_at
         FROM cs_conversations c
        WHERE c.status IN ('queued', 'active')
          AND c.created_at < now() - make_interval(mins => $1)
          AND NOT EXISTS (
            SELECT 1 FROM cs_messages m
             WHERE m.conversation_id = c.id AND m.sender = 'agent' AND m.internal = false
          )
        ORDER BY c.created_at
        LIMIT $2`,
      [thresholdMinutes, limit]
    );
    return rows.rows.map((r) => ({ conversationId: String(r.id), userId: String(r.user_id), createdAt: new Date(r.created_at as string) }));
  }

  async findOnlineSupervisors(onlineWindowSeconds: number): Promise<Array<{ adminId: string; displayName: string }>> {
    const rows = await this.pool.query(
      `SELECT a.id, a.display_name
         FROM admins a JOIN cs_agent_presence p ON p.agent_id = a.id
        WHERE a.role = 'cs_supervisor' AND a.status = 'active'
          AND p.heartbeat_at > now() - make_interval(secs => $1)
        ORDER BY a.id`,
      [onlineWindowSeconds]
    );
    return rows.rows.map((r) => ({ adminId: String(r.id), displayName: String(r.display_name) }));
  }

  async listActiveSupervisors(): Promise<Array<{ adminId: string; displayName: string }>> {
    const rows = await this.pool.query(
      `SELECT id, display_name FROM admins WHERE role = 'cs_supervisor' AND status = 'active' ORDER BY id`,
      []
    );
    return rows.rows.map((r) => ({ adminId: String(r.id), displayName: String(r.display_name) }));
  }

  async findSucceededRefundsWithoutNotification(limit: number): Promise<Array<{ refundId: string; orderId: string; userId: string; amountFen: number }>> {
    const rows = await this.pool.query(
      `SELECT r.id, r.order_id, r.user_id, r.amount_fen
         FROM refunds r
        WHERE r.status = 'succeeded'
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.idempotency_key = 'refund.succeeded:' || r.id::text)
        ORDER BY r.updated_at
        LIMIT $1`,
      [limit]
    );
    return rows.rows.map((r) => ({ refundId: String(r.id), orderId: String(r.order_id), userId: String(r.user_id), amountFen: Number(r.amount_fen) }));
  }

  async findSuccessGroupOrdersWithoutNotification(limit: number): Promise<Array<{ orderId: string; userId: string; groupId: string }>> {
    const rows = await this.pool.query(
      `SELECT o.id, o.user_id, o.group_id
         FROM orders o JOIN groups g ON g.id = o.group_id
        WHERE g.status = 'success' AND o.status = 'paid'
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.idempotency_key = 'group.succeeded:' || o.id::text)
        ORDER BY o.paid_at
        LIMIT $1`,
      [limit]
    );
    return rows.rows.map((r) => ({ orderId: String(r.id), userId: String(r.user_id), groupId: String(r.group_id) }));
  }
}
