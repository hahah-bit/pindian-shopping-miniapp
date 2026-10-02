import type { Pool, PoolClient } from 'pg';
import { withExecutor, isPoolClient, type PgExecutor } from '../../../../../adapters-shared/pg-client';
import { Notification, type DeliveryState, type DeliveryStatusValue, type NotificationState } from '../../../domain/notification';
import type { NotificationRepository } from '../../../application/ports';

type Row = Record<string, unknown>;

const DELIVERY_COLUMNS = `id, notification_id, channel, status, attempt_count, max_attempts, last_error, next_attempt_at, sent_at, skipped_reason, updated_at, lease_token`;

function deliveryOf(row: Row): DeliveryState {
  return {
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    deliveryId: String(row.id),
    notificationId: String(row.notification_id),
    channel: String(row.channel),
    status: String(row.status) as DeliveryStatusValue,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    lastError: row.last_error === null ? null : String(row.last_error),
    nextAttemptAt: row.next_attempt_at ? new Date(row.next_attempt_at as string) : null,
    sentAt: row.sent_at ? new Date(row.sent_at as string) : null,
    skippedReason: row.skipped_reason === null ? null : String(row.skipped_reason),
    updatedAt: row.updated_at ? new Date(row.updated_at as string) : null
  };
}

function notificationOf(row: Row, deliveries: DeliveryState[]): Notification {
  const state: NotificationState = {
    notificationId: String(row.id),
    recipientAdminId: row.recipient_admin_id === null ? null : String(row.recipient_admin_id),
    recipientUserId: row.recipient_user_id === null ? null : String(row.recipient_user_id),
    eventType: String(row.event_type),
    title: String(row.title),
    body: String(row.body),
    reference: (row.reference ?? {}) as Record<string, unknown>,
    idempotencyKey: String(row.idempotency_key),
    readAt: row.read_at ? new Date(row.read_at as string) : null,
    createdAt: row.created_at ? new Date(row.created_at as string) : null,
    deliveries
  };
  return new Notification(state);
}

export class PostgresNotificationRepository implements NotificationRepository {
  private readonly pool: PgExecutor;

  constructor(pool: PgExecutor) {
    this.pool = pool;
  }

  async insertIfAbsent(notification: Notification): Promise<{ created: boolean; notification: Notification }> {
    return withExecutor(this.pool, async (client) => {
      const ownTransaction = !isPoolClient(this.pool);
      if (ownTransaction) await client.query('BEGIN');
      try {
      const s = notification.state;
      const inserted = await client.query<Row>(
        `INSERT INTO notifications (id, recipient_admin_id, recipient_user_id, event_type, title, body, reference, idempotency_key, created_at)
         VALUES (COALESCE($1, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [s.notificationId, s.recipientAdminId, s.recipientUserId, s.eventType, s.title, s.body, JSON.stringify(s.reference), s.idempotencyKey, s.createdAt]
      );
      if (inserted.rows.length === 0 || inserted.rows[0] === undefined) {
        const existing = await this.findByKey(s.idempotencyKey, client);
        if (ownTransaction) await client.query('COMMIT');
        return { created: false, notification: existing as Notification };
      }
      const notificationId = String(inserted.rows[0].id);
      s.notificationId = notificationId;
      for (const delivery of s.deliveries) {
        const d = await client.query<Row>(
          `INSERT INTO notification_deliveries (notification_id, channel, status, attempt_count, max_attempts, next_attempt_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [notificationId, delivery.channel, delivery.status, delivery.attemptCount, delivery.maxAttempts, delivery.nextAttemptAt, delivery.updatedAt]
        );
        const deliveryIdRow = d.rows[0];
        if (!deliveryIdRow) throw new Error('投递插入未返回 id');
        delivery.deliveryId = String(deliveryIdRow.id);
        delivery.notificationId = notificationId;
      }
      if (ownTransaction) await client.query('COMMIT');
      return { created: true, notification };
      } catch (error) {
        if (ownTransaction) await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  private async findByKey(idempotencyKey: string, client?: PoolClient): Promise<Notification | null> {
    return withExecutor(client ?? this.pool, async (executor) => {
      const row = await executor.query<Row>(`SELECT * FROM notifications WHERE idempotency_key=$1`, [idempotencyKey]);
      const first = row.rows[0];
      if (!first) return null;
      return this.hydrateWithDeliveries(executor, first);
    });
  }

  private async hydrateWithDeliveries(executor: PoolClient, row: Row): Promise<Notification> {
    const deliveries = await executor.query<Row>(
      `SELECT ${DELIVERY_COLUMNS} FROM notification_deliveries WHERE notification_id=$1 ORDER BY channel`,
      [String(row.id)]
    );
    return notificationOf(row, deliveries.rows.map(deliveryOf));
  }

  async findById(notificationId: string): Promise<Notification | null> {
    return withExecutor(this.pool, async (client) => {
      const row = await client.query<Row>(`SELECT * FROM notifications WHERE id=$1`, [notificationId]);
      const first = row.rows[0];
      if (!first) return null;
      return this.hydrateWithDeliveries(client, first);
    });
  }

  async claimDueDeliveries(limit: number, now: Date, leaseMinutes: number): Promise<Array<{ delivery: DeliveryState; notification: Notification }>> {
    return withExecutor(this.pool, async (client) => {
      const claimed = await client.query<Row>(
        `UPDATE notification_deliveries d
            SET lease_until = $2 + make_interval(mins => $3), lease_token = gen_random_uuid(), updated_at = $2
          WHERE d.id IN (
            SELECT id FROM notification_deliveries
             WHERE (status = 'pending' OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= $2))
               AND (lease_until IS NULL OR lease_until <= $2)
             ORDER BY created_at
             FOR UPDATE SKIP LOCKED
             LIMIT $1
          )
          RETURNING ${DELIVERY_COLUMNS}`,
        [limit, now, leaseMinutes]
      );
      const result: Array<{ delivery: DeliveryState; notification: Notification }> = [];
      for (const row of claimed.rows) {
        const delivery = deliveryOf(row);
        const notificationRow = await client.query<Row>(`SELECT * FROM notifications WHERE id=$1`, [delivery.notificationId]);
        const notificationFirst = notificationRow.rows[0];
        if (!notificationFirst) continue;
        result.push({ delivery, notification: notificationOf(notificationFirst, [delivery]) });
      }
      return result;
    });
  }

  async saveDelivery(delivery: DeliveryState): Promise<void> {
    await withExecutor(this.pool, async (client) => {
      await client.query(
        `UPDATE notification_deliveries
            SET status=$2, attempt_count=$3, max_attempts=$4, last_error=$5, next_attempt_at=$6, sent_at=$7, skipped_reason=$8, updated_at=$9, lease_token=NULL, lease_until=NULL
          WHERE id=$1 AND lease_token IS NOT DISTINCT FROM $10::uuid`,
        [delivery.deliveryId, delivery.status, delivery.attemptCount, delivery.maxAttempts, delivery.lastError, delivery.nextAttemptAt, delivery.sentAt, delivery.skippedReason, delivery.updatedAt, delivery.leaseToken ?? null]
      );
    });
  }

  async findDeliveryById(deliveryId: string, sessionTx?: unknown): Promise<{ delivery: DeliveryState; notification: Notification } | null> {
    return withExecutor(isPoolClient(sessionTx) ? sessionTx : this.pool, async (client) => {
      const row = await client.query<Row>(`SELECT ${DELIVERY_COLUMNS} FROM notification_deliveries WHERE id=$1`, [deliveryId]);
      const deliveryFirst = row.rows[0];
      if (!deliveryFirst) return null;
      const delivery = deliveryOf(deliveryFirst);
      const notificationRow = await client.query<Row>(`SELECT * FROM notifications WHERE id=$1`, [delivery.notificationId]);
      const notificationFirst = notificationRow.rows[0];
      if (!notificationFirst) return null;
      return { delivery, notification: notificationOf(notificationFirst, [delivery]) };
    });
  }

  async resetDeliveryFailed(deliveryId: string, now: Date, sessionTx?: unknown): Promise<DeliveryState | null> {
    return withExecutor(isPoolClient(sessionTx) ? sessionTx : this.pool, async (client) => {
      const row = await client.query<Row>(
        `UPDATE notification_deliveries
            SET status='pending', attempt_count=0, last_error=NULL, next_attempt_at=NULL, updated_at=$2, lease_token=NULL, lease_until=NULL
          WHERE id=$1 AND status='failed' AND (lease_until IS NULL OR lease_until <= $2)
          RETURNING ${DELIVERY_COLUMNS}`,
        [deliveryId, now]
      );
      const resetFirst = row.rows[0];
      return resetFirst ? deliveryOf(resetFirst) : null;
    });
  }

  async listDeliveries(query: { status?: string | null; channel?: string | null; eventType?: string | null; page: number; pageSize: number }): Promise<{ items: Array<{ delivery: DeliveryState; notification: Notification; recipientType: 'admin' | 'user'; recipientName: string }>; total: number }> {
    return withExecutor(this.pool, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      const add = (fragment: string, value: unknown): void => {
        params.push(value);
        conditions.push(fragment.replace('$?', `$${params.length}`));
      };
      if (query.status) add(`d.status = $?`, query.status);
      if (query.channel) add(`d.channel = $?`, query.channel);
      if (query.eventType) add(`n.event_type = $?`, query.eventType);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const total = await client.query<Row>(`SELECT COUNT(*)::int AS c FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id ${where}`, params);
      const page = Math.max(1, query.page);
      const pageSize = Math.min(50, Math.max(1, query.pageSize));
      params.push(pageSize, (page - 1) * pageSize);
      const rows = await client.query<Row>(
        `SELECT d.*, n.event_type, n.title AS notification_title, n.body AS notification_body, n.reference, n.idempotency_key, n.read_at AS notification_read_at,
                n.created_at AS notification_created_at, n.recipient_admin_id, n.recipient_user_id,
                a.display_name AS admin_name, u.nickname AS user_name
           FROM notification_deliveries d
           JOIN notifications n ON n.id = d.notification_id
           LEFT JOIN admins a ON a.id = n.recipient_admin_id
           LEFT JOIN users u ON u.id = n.recipient_user_id
           ${where}
           ORDER BY d.created_at DESC, d.id DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      const totalRow = total.rows[0];
      if (!totalRow) throw new Error('投递计数查询未返回行');
      return {
        total: Number(totalRow.c),
        items: rows.rows.map((row) => {
          const delivery = deliveryOf(row);
          const notification = new Notification({
            notificationId: delivery.notificationId,
            recipientAdminId: row.recipient_admin_id === null ? null : String(row.recipient_admin_id),
            recipientUserId: row.recipient_user_id === null ? null : String(row.recipient_user_id),
            eventType: String(row.event_type),
            title: String(row.notification_title),
            body: String(row.notification_body),
            reference: (row.reference ?? {}) as Record<string, unknown>,
            idempotencyKey: String(row.idempotency_key),
            readAt: row.notification_read_at ? new Date(row.notification_read_at as string) : null,
            createdAt: row.notification_created_at ? new Date(row.notification_created_at as string) : null,
            deliveries: [delivery]
          });
          return {
            delivery,
            notification,
            recipientType: notification.state.recipientAdminId ? ('admin' as const) : ('user' as const),
            recipientName: String(row.admin_name ?? row.user_name ?? '（未知）')
          };
        })
      };
    });
  }

  async listUserNotifications(userId: string, page: number, pageSize: number): Promise<{ items: Notification[]; total: number; unreadCount: number }> {
    return withExecutor(this.pool, async (client) => {
      const unread = await client.query<Row>(`SELECT COUNT(*)::int AS c FROM notifications WHERE recipient_user_id=$1 AND read_at IS NULL`, [userId]);
      const total = await client.query<Row>(`SELECT COUNT(*)::int AS c FROM notifications WHERE recipient_user_id=$1`, [userId]);
      const safePage = Math.max(1, page);
      const safeSize = Math.min(50, Math.max(1, pageSize));
      const rows = await client.query<Row>(
        `SELECT * FROM notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [userId, safeSize, (safePage - 1) * safeSize]
      );
      const items: Notification[] = [];
      for (const row of rows.rows) items.push(await this.hydrateWithDeliveries(client, row));
      const totalRow = total.rows[0];
      const unreadRow = unread.rows[0];
      if (!totalRow || !unreadRow) throw new Error('通知计数查询未返回行');
      return { items, total: Number(totalRow.c), unreadCount: Number(unreadRow.c) };
    });
  }

  async findUserNotification(notificationId: string, userId: string): Promise<Notification | null> {
    return withExecutor(this.pool, async (client) => {
      const row = await client.query<Row>(`SELECT * FROM notifications WHERE id=$1 AND recipient_user_id=$2`, [notificationId, userId]);
      const first = row.rows[0];
      if (!first) return null;
      return this.hydrateWithDeliveries(client, first);
    });
  }

  async markRead(notificationId: string, userId: string, now: Date): Promise<void> {
    await withExecutor(this.pool, async (client) => {
      await client.query(`UPDATE notifications SET read_at=$3 WHERE id=$1 AND recipient_user_id=$2 AND read_at IS NULL`, [notificationId, userId, now]);
    });
  }
}
