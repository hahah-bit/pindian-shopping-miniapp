import type { PoolClient } from 'pg';
import { Payment, type PaymentState } from '../../../domain/payment';
import type { PaymentRepository } from '../../../application/ports';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface PaymentRow {
  id: string;
  order_id: string;
  user_id: string;
  amount_fen: number;
  status: PaymentState['status'];
  out_trade_no: string;
  channel_transaction_id: string | null;
  applied_result: PaymentState['appliedResult'];
  prepay_id: string | null;
  prepay_expires_at: Date | null;
  success_source: PaymentState['successSource'];
  channel_payload: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

function paymentOf(row: PaymentRow): Payment {
  return Payment.rehydrate({
    paymentId: row.id,
    orderId: row.order_id,
    userId: row.user_id,
    amountFen: row.amount_fen,
    status: row.status,
    outTradeNo: row.out_trade_no,
    channelTransactionId: row.channel_transaction_id,
    appliedResult: row.applied_result,
    prepayId: row.prepay_id,
    prepayExpiresAt: row.prepay_expires_at,
    successSource: row.success_source,
    channelPayload: row.channel_payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

const COLUMNS = `id, order_id, user_id, amount_fen, status, out_trade_no, channel_transaction_id, applied_result, prepay_id, prepay_expires_at, success_source, channel_payload, created_at, updated_at`;

export class PostgresPaymentRepository implements PaymentRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  async insert(payment: Payment): Promise<void> {
    const s = payment.state;
    await this.query((client) => client.query(
      `INSERT INTO payments (${COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [s.paymentId, s.orderId, s.userId, s.amountFen, s.status, s.outTradeNo, s.channelTransactionId, s.appliedResult, s.prepayId, s.prepayExpiresAt, s.successSource, s.channelPayload ? JSON.stringify(s.channelPayload) : null, s.createdAt, s.updatedAt, s.updatedAt]
    ));
  }

  async findByOrderId(orderId: string): Promise<Payment | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<PaymentRow>(`SELECT ${COLUMNS} FROM payments WHERE order_id = $1`, [orderId]);
      return rows[0] ? paymentOf(rows[0]) : null;
    });
  }

  async findById(paymentId: string): Promise<Payment | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<PaymentRow>(`SELECT ${COLUMNS} FROM payments WHERE id = $1`, [paymentId]);
      return rows[0] ? paymentOf(rows[0]) : null;
    });
  }

  async save(payment: Payment): Promise<void> {
    const s = payment.state;
    await this.query((client) => client.query(
      `UPDATE payments SET status = $2, channel_transaction_id = $3, applied_result = $4, prepay_id = $5, prepay_expires_at = $6, success_source = $7, channel_payload = $8, updated_at = $9 WHERE id = $1`,
      [s.paymentId, s.status, s.channelTransactionId, s.appliedResult, s.prepayId, s.prepayExpiresAt, s.successSource, s.channelPayload ? JSON.stringify(s.channelPayload) : null, s.updatedAt]
    ));
  }

  async findStale(now: Date, limit: number): Promise<Payment[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<PaymentRow>(
        `SELECT ${COLUMNS} FROM payments WHERE status IN ('processing', 'unknown') AND updated_at <= $1 ORDER BY updated_at ASC LIMIT $2`,
        [now, limit]
      );
      return rows.map(paymentOf);
    });
  }

  async countByStatus(status: 'pending_review' | 'processing' | 'unknown'): Promise<number> {
    return this.countByAppliedResult(status);
  }

  async countByAppliedResult(result: string): Promise<number> {
    return this.query(async (client) => {
      const { rows } = await client.query<{ count: string }>('SELECT COUNT(*)::int4 AS count FROM payments WHERE applied_result = $1', [result]);
      return Number(rows[0]?.count ?? 0);
    });
  }

  async listAdmin(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: Payment[]; total: number }> {
    return this.query(async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.status && ['created', 'processing', 'succeeded', 'closed', 'unknown'].includes(query.status)) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await client.query<PaymentRow>(
        `SELECT ${COLUMNS} FROM payments ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize]
      );
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM payments ${where}`, params);
      return { items: rows.map(paymentOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }
}
