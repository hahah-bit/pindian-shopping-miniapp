import { ApplicationError } from '../../../../shared/kernel';
import { withExecutor, type PgExecutor } from '../../../../adapters-shared/pg-client';

/** ProductSnapshot 端口结构（由 IdentityAccess 侧工作流依赖定义）。 */
export interface ProductSellableSnapshot {
  productId: string;
  snapshot: {
    originalPriceFen: number;
    userWholePriceFen: number;
    allowedShareUnits: Array<30 | 20 | 15 | 12>;
    wholeQuantityText: string;
    unit: string;
  };
  deadlineHours: number;
}

export interface StockReservationPort {
  reserveOne(productId: string, businessKey: string): Promise<void>;
  releaseOne(productId: string, businessKey: string): Promise<void>;
  consumeOne(productId: string, businessKey: string): Promise<void>;
}

export function getProductSnapshotPort(pool: PgExecutor): { getSellableSnapshot(productId: string): Promise<ProductSellableSnapshot | null> } {
  return {
    async getSellableSnapshot(productId: string) {
      return withExecutor(pool, async (client) => {
        const { rows } = await client.query<{
          id: string;
          original_price_fen: number;
          whole_quantity: string;
          unit: string;
          allowed_share_units: number[];
          status: string;
          group_deadline_hours: number;
        }>('SELECT id, original_price_fen, whole_quantity, unit, allowed_share_units, status, group_deadline_hours FROM products WHERE id = $1', [productId]);
        const row = rows[0];
        if (!row || row.status !== 'on_shelf') return null;
        return {
          productId: row.id,
          snapshot: {
            originalPriceFen: row.original_price_fen,
            userWholePriceFen: row.original_price_fen + 500,
            allowedShareUnits: row.allowed_share_units as ProductSellableSnapshot["snapshot"]["allowedShareUnits"],
            wholeQuantityText: normalizeQuantity(row.whole_quantity),
            unit: row.unit
          },
          deadlineHours: row.group_deadline_hours
        };
      });
    }
  };
}

function normalizeQuantity(text: string): string {
  const [intPart = '0', decimalPart] = text.split('.');
  if (decimalPart === undefined) return intPart;
  const trimmed = decimalPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

/** 整件库存预留端口（Inventory 公开能力适配器）：条件更新，并发安全。 */
export function getStockReservationPort(pool: PgExecutor): StockReservationPort {
  const ID_KEY = /^[a-z-]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  return {
    async reserveOne(productId, businessKey) {
      if (!ID_KEY.test(businessKey)) throw new ApplicationError('VALIDATION_FAILED', '库存幂等键格式无效');
      await withExecutor(pool, async (client) => {
        const adjust = await client.query(
          `UPDATE stocks SET available_whole_items = available_whole_items - 1, reserved_whole_items = reserved_whole_items + 1, updated_at = now()
           WHERE product_id = $1 AND available_whole_items > 0`,
          [productId]
        );
        if ((adjust.rowCount ?? 0) === 0) throw new ApplicationError('STOCK_INSUFFICIENT', '库存不足，无法创建拼单组');
        await client.query(
          `INSERT INTO stock_movements (product_id, delta, resulting_available, reason, business_key, created_at)
           SELECT product_id, -1, available_whole_items, '建组预留整件', $2, now() FROM stocks WHERE product_id = $1`,
          [productId, businessKey]
        ).catch(async (error) => {
          const code = (error as { code?: string }).code;
          if (code === '23505') return; // 幂等重放：movement 已存在（事务将整体回滚由调用方处理）
          throw error;
        });
      });
    },
    async releaseOne(productId, businessKey) {
      if (!ID_KEY.test(businessKey)) throw new ApplicationError('VALIDATION_FAILED', '库存幂等键格式无效');
      await withExecutor(pool, async (client) => {
        const adjust = await client.query(
          `UPDATE stocks SET available_whole_items = available_whole_items + 1, reserved_whole_items = GREATEST(reserved_whole_items - 1, 0), updated_at = now()
           WHERE product_id = $1 AND reserved_whole_items > 0`,
          [productId]
        );
        if ((adjust.rowCount ?? 0) === 0) throw new ApplicationError('STOCK_INSUFFICIENT', '库存预留不存在');
        await client.query(
          `INSERT INTO stock_movements (product_id, delta, resulting_available, reason, business_key, created_at)
           SELECT product_id, 1, available_whole_items, '组失败释放整件', $2, now() FROM stocks WHERE product_id = $1`,
          [productId, businessKey]
        ).catch((error) => {
          const code = (error as { code?: string }).code;
          if (code === '23505') return;
          throw error;
        });
      });
    },
    async consumeOne(productId, businessKey) {
      if (!ID_KEY.test(businessKey)) throw new ApplicationError('VALIDATION_FAILED', '库存幂等键格式无效');
      await withExecutor(pool, async (client) => {
        const adjust = await client.query(
          `UPDATE stocks SET reserved_whole_items = GREATEST(reserved_whole_items - 1, 0), updated_at = now()
           WHERE product_id = $1 AND reserved_whole_items > 0`,
          [productId]
        );
        if ((adjust.rowCount ?? 0) === 0) throw new ApplicationError('STOCK_INSUFFICIENT', '库存预留不存在');
        await client.query(
          `INSERT INTO stock_movements (product_id, delta, resulting_available, reason, business_key, created_at)
           SELECT product_id, 0, available_whole_items, '组成功消耗整件', $2, now() FROM stocks WHERE product_id = $1`,
          [productId, businessKey]
        ).catch((error) => {
          const code = (error as { code?: string }).code;
          if (code === '23505') return;
          throw error;
        });
      });
    }
  };
}
