import type { PoolClient } from 'pg';
import { Refund, type RefundState } from '../../../domain/refund';
import type { RefundRepositoryPort } from '../../../application/refund-ports';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface RefundRow {
  id: string;
  payment_id: string;
  order_id: string;
  user_id: string;
  out_refund_no: string;
  amount_fen: number;
  status: RefundState['status'];
  reason: RefundState['reason'];
  channel_refund_id: string | null;
  fail_reason: string | null;
  retry_count: number;
  requested_at: Date;
  succeeded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function refundOf(row: RefundRow): Refund {
  return Refund.rehydrate({
    refundId: row.id,
    paymentId: row.payment_id,
    orderId: row.order_id,
    userId: row.user_id,
    outRefundNo: row.out_refund_no,
    amountFen: row.amount_fen,
    status: row.status,
    reason: row.reason,
    channelRefundId: row.channel_refund_id,
    failReason: row.fail_reason,
    retryCount: row.retry_count,
    requestedAt: row.requested_at,
    succeededAt: row.succeeded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

const COLUMNS = `id, payment_id, order_id, user_id, out_refund_no, amount_fen, status, reason, channel_refund_id, fail_reason, retry_count, requested_at, succeeded_at, created_at, updated_at`;

export class PostgresRefundRepository implements RefundRepositoryPort {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  /** 有外层事务时在会话上执行（与支付确认/取消流程同事务，R4）。 */
  private async queryIn<T>(sessionTx: unknown, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (sessionTx) return withExecutor(sessionTx as PgExecutor, work);
    return this.query(work);
  }

  async insert(refund: Refund, sessionTx?: unknown): Promise<void> {
    const s = refund.state;
    await this.queryIn(sessionTx, (client) => client.query(
      `INSERT INTO refunds (${COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [s.refundId, s.paymentId, s.orderId, s.userId, s.outRefundNo, s.amountFen, s.status, s.reason, s.channelRefundId, s.failReason, s.retryCount, s.requestedAt, s.succeededAt, s.createdAt, s.updatedAt]
    ));
  }

  async findByPaymentId(paymentId: string): Promise<Refund[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<RefundRow>(`SELECT ${COLUMNS} FROM refunds WHERE payment_id = $1 ORDER BY created_at ASC`, [paymentId]);
      return rows.map(refundOf);
    });
  }

  async findById(refundId: string): Promise<Refund | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<RefundRow>(`SELECT ${COLUMNS} FROM refunds WHERE id = $1`, [refundId]);
      return rows[0] ? refundOf(rows[0]) : null;
    });
  }

  async findByOutRefundNo(outRefundNo: string): Promise<Refund | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<RefundRow>(`SELECT ${COLUMNS} FROM refunds WHERE out_refund_no = $1`, [outRefundNo]);
      return rows[0] ? refundOf(rows[0]) : null;
    });
  }

  async save(refund: Refund, sessionTx?: unknown): Promise<void> {
    const s = refund.state;
    await this.queryIn(sessionTx, (client) => client.query(
      `UPDATE refunds SET status = $2, channel_refund_id = $3, fail_reason = $4, retry_count = $5, succeeded_at = $6, updated_at = $7 WHERE id = $1`,
      [s.refundId, s.status, s.channelRefundId, s.failReason, s.retryCount, s.succeededAt, s.updatedAt]
    ));
  }

  async findRefundDueForSubmit(now: Date, limit: number): Promise<Refund[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<RefundRow>(
        `SELECT ${COLUMNS} FROM refunds WHERE status = 'requested' ORDER BY created_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      void now;
      return rows.map(refundOf);
    });
  }

  async findRefundDueForQuery(now: Date, limit: number): Promise<Refund[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<RefundRow>(
        `SELECT ${COLUMNS} FROM refunds WHERE status IN ('submitted', 'processing') ORDER BY updated_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      void now;
      return rows.map(refundOf);
    });
  }

  async countFailedRefunds(): Promise<number> {
    return this.query(async (client) => {
      const { rows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM refunds WHERE status = 'failed'`);
      return Number(rows[0]?.total ?? 0);
    });
  }

  async listAdmin(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: Refund[]; total: number }> {
    return this.query(async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.status && ['requested', 'submitted', 'processing', 'succeeded', 'failed'].includes(query.status)) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM refunds ${where}`, params);
      const { rows } = await client.query<RefundRow>(
        `SELECT ${COLUMNS} FROM refunds ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize]
      );
      return { items: rows.map(refundOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }
}
