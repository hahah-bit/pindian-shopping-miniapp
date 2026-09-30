import { ApplicationError } from '../../../shared/kernel';

export const MAX_STOCK_WHOLE_ITEMS = 100_000;
export const MAX_ADJUST_DELTA = 1_000_000;

export interface StockState {
  productId: string;
  availableWholeItems: number;
  /** 预留字段：本阶段恒为 0；整件预占属后续交易任务，任何用例不得写入。 */
  reservedWholeItems: number;
  updatedAt: Date;
}

/** 整件库存聚合根。 */
export class Stock {
  private constructor(readonly state: StockState) {}

  static initialize(productId: string, wholeItems: unknown, now: Date): Stock {
    if (typeof wholeItems !== 'number' || !Number.isInteger(wholeItems) || wholeItems < 0 || wholeItems > MAX_STOCK_WHOLE_ITEMS) {
      throw new ApplicationError('VALIDATION_FAILED', `整件库存必须为 0-${MAX_STOCK_WHOLE_ITEMS} 的整数`);
    }
    return new Stock({ productId, availableWholeItems: wholeItems, reservedWholeItems: 0, updatedAt: now });
  }

  static rehydrate(state: StockState): Stock {
    return new Stock({ ...state });
  }

  /** 校验并应用增量；结果为负抛出 CONFLICT，超过上限抛出 VALIDATION_FAILED。 */
  applyDelta(delta: unknown, now: Date): Stock {
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_ADJUST_DELTA) {
      throw new ApplicationError('VALIDATION_FAILED', `库存增量必须为绝对值不超过 ${MAX_ADJUST_DELTA} 的非零整数`);
    }
    const result = this.state.availableWholeItems + delta;
    if (result < 0) throw new ApplicationError('CONFLICT', `库存不足，调整后不能为负数（当前 ${this.state.availableWholeItems}）`);
    if (result > MAX_STOCK_WHOLE_ITEMS) throw new ApplicationError('VALIDATION_FAILED', `库存不能超过 ${MAX_STOCK_WHOLE_ITEMS}`);
    return new Stock({ ...this.state, availableWholeItems: result, updatedAt: now });
  }

  get isSoldOut(): boolean {
    return this.state.availableWholeItems <= 0;
  }
}

export interface StockMovementState {
  movementId: string;
  productId: string;
  delta: number;
  resultingAvailable: number;
  reason: string;
  actorAdminId: string | null;
  requestId: string | null;
  createdAt: Date;
}

/** 库存变动记录：不可变追加事实。 */
export class StockMovement {
  readonly state: StockMovementState;

  static create(input: Omit<StockMovementState, 'movementId'> & { movementId?: string }): StockMovement {
    return new StockMovement({ ...input, movementId: input.movementId ?? crypto.randomUUID() });
  }

  constructor(state: StockMovementState) {
    if (!Number.isInteger(state.delta) || state.delta === 0) {
      throw new ApplicationError('VALIDATION_FAILED', '库存变动增量必须为非零整数');
    }
    if (!Number.isInteger(state.resultingAvailable) || state.resultingAvailable < 0) {
      throw new ApplicationError('VALIDATION_FAILED', '库存变动结果不能为负数');
    }
    const reason = state.reason.trim();
    if (reason.length < 1 || reason.length > 200) throw new ApplicationError('VALIDATION_FAILED', '库存调整原因须为 1-200 字符');
    this.state = { ...state, reason };
  }
}
