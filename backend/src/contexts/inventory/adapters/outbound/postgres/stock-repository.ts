import type { PoolClient } from 'pg';
import { Stock, StockMovement, type StockState, type StockMovementState } from '../../../domain/stock';
import type { StockAdjustCommand, StockAdjustmentOutcome, StockRepository } from '../../../application/ports';
import { isPoolClient, withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface StockRow {
  product_id: string;
  available_whole_items: number;
  reserved_whole_items: number;
  updated_at: Date;
}

interface MovementRow {
  id: string;
  product_id: string;
  delta: number;
  resulting_available: number;
  reason: string;
  actor_admin_id: string | null;
  request_id: string | null;
  created_at: Date;
}

function stockOf(row: StockRow): Stock {
  return Stock.rehydrate({
    productId: row.product_id,
    availableWholeItems: row.available_whole_items,
    reservedWholeItems: row.reserved_whole_items,
    updatedAt: row.updated_at
  });
}

function movementOf(row: MovementRow): StockMovement {
  return new StockMovement({
    movementId: row.id,
    productId: row.product_id,
    delta: row.delta,
    resultingAvailable: row.resulting_available,
    reason: row.reason,
    actorAdminId: row.actor_admin_id,
    requestId: row.request_id,
    createdAt: row.created_at
  });
}

const MOVEMENT_COLUMNS = 'id, product_id, delta, resulting_available, reason, actor_admin_id, request_id, created_at';

/**
 * 库存仓储（pg）：adjust 在行锁事务内完成“读取-计算-更新-留痕”，
 * (product_id, request_id) 唯一索引提供幂等；并发唯一冲突转幂等重放。
 */
export class PostgresStockRepository implements StockRepository {
  constructor(private readonly pool: PgExecutor) {}

  async initialize(stock: Stock, movement: StockMovement | null, session?: unknown): Promise<void> {
    await withExecutor((session as PgExecutor) ?? this.pool, (client) => client.query(
      'INSERT INTO stocks (product_id, available_whole_items, reserved_whole_items, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (product_id) DO NOTHING',
      [stock.state.productId, stock.state.availableWholeItems, stock.state.reservedWholeItems, stock.state.updatedAt]
    ));
    if (movement) {
      const m = movement.state;
      await withExecutor((session as PgExecutor) ?? this.pool, (client) => client.query(
        `INSERT INTO stock_movements (product_id, delta, resulting_available, reason, actor_admin_id, request_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [m.productId, m.delta, m.resultingAvailable, m.reason, m.actorAdminId, m.requestId, m.createdAt]
      ));
    }
  }

  async findById(productId: string): Promise<Stock | null> {
    return withExecutor(this.pool, async (client) => {
      const { rows } = await client.query<StockRow>('SELECT * FROM stocks WHERE product_id = $1', [productId]);
      return rows[0] ? stockOf(rows[0]) : null;
    });
  }

  async adjust(command: StockAdjustCommand): Promise<StockAdjustmentOutcome | null> {
    const client = await (isPoolClient(this.pool) ? this.pool : this.pool.connect());
    const own = !isPoolClient(this.pool);
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<StockRow>('SELECT * FROM stocks WHERE product_id = $1 FOR UPDATE', [command.productId]);
      const row = rows[0];
      if (!row) {
        await client.query('COMMIT');
        return null;
      }
      const stock = stockOf(row);
      if (command.requestId) {
        const { rows: existingRows } = await client.query<MovementRow & { id: string }>(
          `SELECT ${MOVEMENT_COLUMNS} FROM stock_movements WHERE product_id = $1 AND request_id = $2`,
          [command.productId, command.requestId]
        );
        if (existingRows[0]) {
          await client.query('COMMIT');
          return { stock, movement: movementOf(existingRows[0]), replayed: true };
        }
      }
      const current = stock.state.availableWholeItems;
      const delta = command.setTo !== undefined ? command.setTo - current : (command.delta ?? 0);
      if (delta === 0) {
        await client.query('COMMIT');
        return { stock, movement: null, replayed: true };
      }
      const updated = stock.applyDelta(delta, command.now);
      await client.query('UPDATE stocks SET available_whole_items = $2, updated_at = $3 WHERE product_id = $1', [
        command.productId, updated.state.availableWholeItems, command.now
      ]);
      try {
        const movement = StockMovement.create({
          productId: command.productId,
          delta,
          resultingAvailable: updated.state.availableWholeItems,
          reason: command.reason,
          actorAdminId: command.actorAdminId,
          requestId: command.requestId ?? null,
          createdAt: command.now
        });
        await client.query(
          `INSERT INTO stock_movements (product_id, delta, resulting_available, reason, actor_admin_id, request_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${MOVEMENT_COLUMNS}`,
          [command.productId, delta, updated.state.availableWholeItems, command.reason, command.actorAdminId, command.requestId ?? null, command.now]
        );
        await client.query('COMMIT');
        return {
          stock: Stock.rehydrate({ ...updated.state, productId: command.productId, updatedAt: command.now }),
          movement,
          replayed: false
        };
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '23505' && command.requestId) {
          // 并发同幂等键：唯一索引拦截，转为幂等重放。
          await client.query('ROLLBACK');
          const { rows: replayRows } = await client.query<MovementRow & { id: string }>(
            `SELECT ${MOVEMENT_COLUMNS} FROM stock_movements WHERE product_id = $1 AND request_id = $2`,
            [command.productId, command.requestId]
          );
          const replay = replayRows[0];
          if (!replay) throw error;
          const fresh = await this.findById(command.productId);
          return { stock: fresh ?? stock, movement: movementOf(replay), replayed: true };
        }
        throw error;
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if (own && isPoolClient(client)) client.release();
    }
  }

  async listMovements(productId: string, page: number, pageSize: number): Promise<{ items: StockMovement[]; total: number }> {
    return withExecutor(this.pool, async (client) => {
      const { rows: countRows } = await client.query<{ total: string }>(
        'SELECT COUNT(*)::int4 AS total FROM stock_movements WHERE product_id = $1', [productId]
      );
      const { rows } = await client.query<MovementRow & { id: string }>(
        `SELECT ${MOVEMENT_COLUMNS} FROM stock_movements WHERE product_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [productId, pageSize, (page - 1) * pageSize]
      );
      return { items: rows.map(movementOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }
}

export type { PoolClient };
