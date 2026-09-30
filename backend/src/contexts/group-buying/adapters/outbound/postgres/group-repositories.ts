import type { PoolClient } from 'pg';
import { Group, type GroupState, type SalePolicySnapshot } from '../../../domain/group';
import { ShareReservation } from '../../../domain/share-reservation';
import type { GroupRepository, ShareReservationRepository } from '../../../application/group-ports';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface GroupRow {
  id: string;
  product_id: string;
  sale_policy_snapshot: SalePolicySnapshot;
  deadline: Date;
  status: GroupState['status'];
  paid_units: number;
  reserved_units: number;
  paid_amount_fen: number;
  paid_goods_amount_fen: number;
  created_at: Date;
  updated_at: Date;
}

function groupOf(row: GroupRow): Group {
  return Group.rehydrate({
    groupId: row.id,
    productId: row.product_id,
    snapshot: row.sale_policy_snapshot,
    deadline: row.deadline,
    status: row.status,
    paidUnits: row.paid_units,
    reservedUnits: row.reserved_units,
    paidAmountFen: row.paid_amount_fen,
    paidGoodsAmountFen: row.paid_goods_amount_fen,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export class PostgresGroupRepository implements GroupRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  async findById(groupId: string): Promise<Group | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<GroupRow>('SELECT * FROM groups WHERE id = $1', [groupId]);
      return rows[0] ? groupOf(rows[0]) : null;
    });
  }

  async findByIdForUpdate(groupId: string, sessionTx: unknown): Promise<Group | null> {
    return withExecutor(sessionTx as PgExecutor, async (client) => {
      const { rows } = await client.query<GroupRow>('SELECT * FROM groups WHERE id = $1 FOR UPDATE', [groupId]);
      return rows[0] ? groupOf(rows[0]) : null;
    });
  }

  /** 候选组：open、未截止、容量足够；排序 remaining↑→created↑→id。可完成性（DP）由应用层过滤——SQL 无法表达。 */
  async findCandidates(query: { productId: string; units: number; now: Date }): Promise<Group[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<GroupRow>(
        `SELECT * FROM groups
         WHERE status = 'open' AND deadline > $2 AND product_id = $1
           AND paid_units + reserved_units + $3 <= 60
         ORDER BY (paid_units + reserved_units) ASC, created_at ASC, id ASC
         LIMIT 20`,
        [query.productId, query.now, query.units]
      );
      return rows.map(groupOf);
    });
  }

  async findExpiredOpenGroups(now: Date, limit: number): Promise<Group[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<GroupRow>(
        "SELECT * FROM groups WHERE status = 'open' AND deadline <= $1 ORDER BY deadline ASC LIMIT $2",
        [now, limit]
      );
      return rows.map(groupOf);
    });
  }

  async listGroups(query: { status?: string | null; productId?: string | null; page: number; pageSize: number }): Promise<{ items: Group[]; total: number }> {
    return this.query(async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.status && ['open', 'success', 'failed'].includes(query.status)) {
        params.push(query.status);
        conditions.push(`status = ${params.length}`);
      }
      if (query.productId) {
        params.push(query.productId);
        conditions.push(`product_id = ${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM groups ${where}`, params);
      const { rows } = await client.query<GroupRow>(
        `SELECT * FROM groups ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize]
      );
      return { items: rows.map(groupOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }

  async insert(group: Group, sessionTx?: unknown): Promise<void> {
    const s = group.state;
    await withExecutor((sessionTx as PgExecutor) ?? this.pool, (client) => client.query(
      `INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units, reserved_units, paid_amount_fen, paid_goods_amount_fen, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [s.groupId, s.productId, JSON.stringify(s.snapshot), s.deadline, s.status, s.paidUnits, s.reservedUnits, s.paidAmountFen, s.paidGoodsAmountFen, s.createdAt, s.updatedAt]
    ));
  }

  async save(group: Group, sessionTx?: unknown): Promise<void> {
    const s = group.state;
    await withExecutor((sessionTx as PgExecutor) ?? this.pool, (client) => client.query(
      `UPDATE groups SET status = $2, paid_units = $3, reserved_units = $4, paid_amount_fen = $5, paid_goods_amount_fen = $6, updated_at = $7
       WHERE id = $1`,
      [s.groupId, s.status, s.paidUnits, s.reservedUnits, s.paidAmountFen, s.paidGoodsAmountFen, s.updatedAt]
    ));
  }
}

interface ReservationRow {
  id: string;
  group_id: string;
  order_id: string;
  units: number;
  status: ShareReservation['state']['status'];
  expires_at: Date;
  converted_at: Date | null;
  created_at: Date;
}

function reservationOf(row: ReservationRow): ShareReservation {
  return ShareReservation.rehydrate({
    reservationId: row.id,
    groupId: row.group_id,
    orderId: row.order_id,
    units: row.units,
    status: row.status,
    expiresAt: row.expires_at,
    convertedAt: row.converted_at ?? null,
    createdAt: row.created_at
  });
}

export class PostgresShareReservationRepository implements ShareReservationRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  async insert(reservation: ShareReservation, sessionTx?: unknown): Promise<void> {
    const s = reservation.state;
    await withExecutor((sessionTx as PgExecutor) ?? this.pool, (client) => client.query(
      `INSERT INTO share_reservations (id, group_id, order_id, units, status, expires_at, converted_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s.reservationId, s.groupId, s.orderId, s.units, s.status, s.expiresAt, s.convertedAt, s.createdAt]
    ));
  }

  async findByOrderId(orderId: string): Promise<ShareReservation | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<ReservationRow>('SELECT * FROM share_reservations WHERE order_id = $1', [orderId]);
      return rows[0] ? reservationOf(rows[0]) : null;
    });
  }

  async save(reservation: ShareReservation, sessionTx?: unknown): Promise<void> {
    const s = reservation.state;
    await withExecutor((sessionTx as PgExecutor) ?? this.pool, (client) => client.query(
      'UPDATE share_reservations SET status = $2, converted_at = $3 WHERE id = $1',
      [s.reservationId, s.status, s.convertedAt]
    ));
  }

  async findExpired(now: Date, limit: number): Promise<ShareReservation[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<ReservationRow>(
        "SELECT * FROM share_reservations WHERE status = 'reserved' AND expires_at <= $1 ORDER BY expires_at ASC LIMIT $2 FOR UPDATE SKIP LOCKED",
        [now, limit]
      );
      return rows.map(reservationOf);
    });
  }

  async listByGroup(groupId: string): Promise<ShareReservation[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<ReservationRow>(
        'SELECT * FROM share_reservations WHERE group_id = $1 ORDER BY created_at ASC',
        [groupId]
      );
      return rows.map(reservationOf);
    });
  }
}
