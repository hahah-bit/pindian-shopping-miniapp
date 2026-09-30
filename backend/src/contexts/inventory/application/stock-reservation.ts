import { ApplicationError, SystemClock, type Clock } from '../../../shared/kernel';
import type { StockRepository } from './ports';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 幂等业务键格式：{动词}:{组ID}，作为 stock_movements.request_id 存储。 */
const IDEMPOTENCY_KEY_PATTERN = /^[a-z-]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface StockReservationResult {
  available: number;
  reserved: number;
  idempotentReplay: boolean;
}

function validateInput(productId: unknown, idempotencyKey: unknown): { productId: string; idempotencyKey: string } {
  if (typeof productId !== 'string' || !UUID_PATTERN.test(productId)) {
    throw new ApplicationError('VALIDATION_FAILED', '商品 ID 格式无效');
  }
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new ApplicationError('VALIDATION_FAILED', '库存幂等键格式无效');
  }
  return { productId, idempotencyKey };
}

/** 整件预留：条件更新 available>0（并发不超卖），业务键幂等（D002）。 */
export class ReserveStock {
  private readonly clock: Clock;
  constructor(deps: { stocks: StockRepository; clock?: Clock }) {
    this.stocks = deps.stocks;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly stocks: StockRepository;

  async execute(input: { productId: unknown; idempotencyKey: unknown }): Promise<StockReservationResult> {
    const { productId, idempotencyKey } = validateInput(input.productId, input.idempotencyKey);
    // 先查可售：为 0 或缺记录直接拒绝（避免依赖底层负值错误语义）
    const current = await this.stocks.findById(productId);
    if (!current || current.state.availableWholeItems <= 0) throw new ApplicationError('STOCK_INSUFFICIENT', '库存不足，无法创建拼单组');
    const outcome = await this.stocks.adjust({
      productId,
      delta: -1,
      reason: `整件预留（${idempotencyKey.split(':')[1]}）`,
      actorAdminId: null,
      businessKey: idempotencyKey,
      reservedDelta: 1,
      allowNegativeAvailable: false,
      now: this.clock.now()
    });
    if (!outcome) throw new ApplicationError('STOCK_INSUFFICIENT', '库存不足，无法创建拼单组');
    return {
      available: outcome.stock.state.availableWholeItems,
      reserved: outcome.stock.state.reservedWholeItems,
      idempotentReplay: outcome.replayed
    };
  }
}

/** 整件释放（组失败/解散）：reserved−1 → available+1，业务键幂等。 */
export class ReleaseStock {
  private readonly clock: Clock;
  constructor(deps: { stocks: StockRepository; clock?: Clock }) {
    this.stocks = deps.stocks;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly stocks: StockRepository;

  async execute(input: { productId: unknown; idempotencyKey: unknown }): Promise<StockReservationResult> {
    const { productId, idempotencyKey } = validateInput(input.productId, input.idempotencyKey);
    const outcome = await this.stocks.adjust({
      productId,
      delta: 1,
      reason: `整件释放（${idempotencyKey.split(':')[1]}）`,
      actorAdminId: null,
      businessKey: idempotencyKey,
      reservedDelta: -1,
      allowNegativeAvailable: false,
      now: this.clock.now()
    });
    if (!outcome) throw new ApplicationError('STOCK_INSUFFICIENT', '库存记录不存在');
    return {
      available: outcome.stock.state.availableWholeItems,
      reserved: outcome.stock.state.reservedWholeItems,
      idempotentReplay: outcome.replayed
    };
  }
}

/** 整件消耗（组拼满）：reserved−1，available 不变（建组时已从可售扣除）。 */
export class ConsumeStock {
  private readonly clock: Clock;
  constructor(deps: { stocks: StockRepository; clock?: Clock }) {
    this.stocks = deps.stocks;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly stocks: StockRepository;

  async execute(input: { productId: unknown; idempotencyKey: unknown }): Promise<StockReservationResult> {
    const { productId, idempotencyKey } = validateInput(input.productId, input.idempotencyKey);
    const outcome = await this.stocks.adjust({
      productId,
      delta: 0,
      reason: `整件消耗（${idempotencyKey.split(':')[1]}）`,
      actorAdminId: null,
      businessKey: idempotencyKey,
      reservedDelta: -1,
      allowNegativeAvailable: false,
      now: this.clock.now()
    });
    if (!outcome) throw new ApplicationError('STOCK_INSUFFICIENT', '库存记录不存在');
    return {
      available: outcome.stock.state.availableWholeItems,
      reserved: outcome.stock.state.reservedWholeItems,
      idempotentReplay: outcome.replayed
    };
  }
}
