import { ApplicationError, SystemClock, type Clock } from '../../../shared/kernel';
import { MAX_ADJUST_DELTA, MAX_STOCK_WHOLE_ITEMS } from '../domain/stock';
import type { StockAdjustCommand, StockRepository } from './ports';

/** 库存调整：参数校验后交由仓储原子执行（行锁 + 幂等）。 */
export class AdjustStock {
  private readonly clock: Clock;
  constructor(deps: { stocks: StockRepository; clock?: Clock }) {
    this.stocks = deps.stocks;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly stocks: StockRepository;

  async execute(input: { productId: unknown; command: { delta?: unknown; setTo?: unknown; reason?: unknown; requestId?: unknown }; actorAdminId: string | null }):
    Promise<{ stock: { productId: string; availableWholeItems: number; reservedWholeItems: number; updatedAt: Date }; movement?: { id: string; delta: number; resultingAvailable: number; reason: string; requestId: string | null; createdAt: Date }; idempotentReplay: boolean }> {
    const command = validateCommand(input.productId, input.command);
    const outcome = await this.stocks.adjust({
      ...command,
      actorAdminId: input.actorAdminId,
      now: this.clock.now()
    });
    if (!outcome) throw new ApplicationError('NOT_FOUND', '商品或库存不存在');
    return {
      stock: {
        productId: outcome.stock.state.productId,
        availableWholeItems: outcome.stock.state.availableWholeItems,
        reservedWholeItems: outcome.stock.state.reservedWholeItems,
        updatedAt: outcome.stock.state.updatedAt
      },
      movement: outcome.movement
        ? {
            id: outcome.movement.state.movementId,
            delta: outcome.movement.state.delta,
            resultingAvailable: outcome.movement.state.resultingAvailable,
            reason: outcome.movement.state.reason,
            requestId: outcome.movement.state.requestId,
            createdAt: outcome.movement.state.createdAt
          }
        : undefined,
      idempotentReplay: outcome.replayed
    };
  }
}

function validateCommand(productId: unknown, raw: { delta?: unknown; setTo?: unknown; reason?: unknown; requestId?: unknown }): { productId: string; delta?: number; setTo?: number; reason: string; requestId?: string } {
  if (typeof productId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
    throw new ApplicationError('VALIDATION_FAILED', '商品 ID 格式无效');
  }
  const hasDelta = raw.delta !== undefined && raw.delta !== null;
  const hasSetTo = raw.setTo !== undefined && raw.setTo !== null;
  if (hasDelta === hasSetTo) {
    throw new ApplicationError('VALIDATION_FAILED', '库存调整必须且只能提供 delta（增量）或 setTo（目标值）之一');
  }
  if (hasDelta) {
    const delta = raw.delta;
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_ADJUST_DELTA) {
      throw new ApplicationError('VALIDATION_FAILED', `增量必须为绝对值不超过 ${MAX_ADJUST_DELTA} 的非零整数`);
    }
  } else {
    const setTo = raw.setTo;
    if (typeof setTo !== 'number' || !Number.isInteger(setTo) || setTo < 0 || setTo > MAX_STOCK_WHOLE_ITEMS) {
      throw new ApplicationError('VALIDATION_FAILED', `目标库存必须为 0-${MAX_STOCK_WHOLE_ITEMS} 的整数`);
    }
  }
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (reason.length < 1 || reason.length > 200) throw new ApplicationError('VALIDATION_FAILED', '库存调整原因须为 1-200 字符');
  let requestId: string | undefined;
  if (raw.requestId !== undefined && raw.requestId !== null && raw.requestId !== '') {
    if (typeof raw.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.requestId)) {
      throw new ApplicationError('VALIDATION_FAILED', '幂等键格式无效');
    }
    requestId = raw.requestId;
  }
  return {
    productId,
    ...(hasDelta ? { delta: raw.delta as number } : {}),
    ...(hasSetTo ? { setTo: raw.setTo as number } : {}),
    reason,
    ...(requestId ? { requestId } : {})
  };
}

/** 变动历史分页查询。 */
export class ListStockMovements {
  constructor(private readonly deps: { stocks: StockRepository }) {}

  async execute(input: { productId: unknown; page?: unknown; pageSize?: unknown }): Promise<{ items: unknown[]; page: number; pageSize: number; total: number }> {
    if (typeof input.productId !== 'string') throw new ApplicationError('VALIDATION_FAILED', '商品 ID 格式无效');
    const page = typeof input.page === 'number' && Number.isInteger(input.page) && input.page >= 1 ? input.page : 1;
    const pageSize = typeof input.pageSize === 'number' && Number.isInteger(input.pageSize) && input.pageSize >= 1 ? Math.min(input.pageSize, 50) : 10;
    const { items, total } = await this.deps.stocks.listMovements(input.productId, page, pageSize);
    return {
      items: items.map((movement) => ({
        id: movement.state.movementId,
        productId: movement.state.productId,
        delta: movement.state.delta,
        resultingAvailable: movement.state.resultingAvailable,
        reason: movement.state.reason,
        requestId: movement.state.requestId,
        createdAt: movement.state.createdAt
      })),
      page,
      pageSize,
      total
    };
  }
}
