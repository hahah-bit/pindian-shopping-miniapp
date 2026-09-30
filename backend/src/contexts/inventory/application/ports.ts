import type { Stock, StockMovement } from '../domain/stock';

export interface StockAdjustCommand {
  productId: string;
  /** 与 setTo 二选一。 */
  delta?: number;
  /** 与 delta 二选一（绝对值，幂等）。 */
  setTo?: number;
  reason: string;
  actorAdminId: string | null;
  requestId?: string;
  /** T004：组预留同步变动 reserved 列（delta=0 允许纯 reserved 流转）。 */
  reservedDelta?: number;
  /** T004：delta=0 的纯 reserved 流转（消耗/释放）允许 available 不变。 */
  allowNegativeAvailable?: boolean;
  /** T004：业务幂等键（group-create:{groupId} 等），唯一索引防重。 */
  businessKey?: string;
  now: Date;
}

export interface StockAdjustmentOutcome {
  stock: Stock;
  /** null 表示本次未产生新变动（幂等键命中或目标值未变化）。 */
  movement: StockMovement | null;
  replayed: boolean;
}

/**
 * 库存仓储。adjust 必须保证原子性：行锁（或等效隔离）内读取-计算-更新-留痕，
 * 并按 (product_id, request_id) 唯一约束实现幂等；实现见 adapters/outbound/postgres。
 */
export interface StockRepository {
  initialize(stock: Stock, movement: StockMovement | null, session?: unknown): Promise<void>;
  findById(productId: string): Promise<Stock | null>;
  adjust(command: StockAdjustCommand): Promise<StockAdjustmentOutcome | null>;
  listMovements(productId: string, page: number, pageSize: number): Promise<{ items: StockMovement[]; total: number }>;
}
