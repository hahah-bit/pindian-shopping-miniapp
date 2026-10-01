import { ApplicationError } from '../../../shared/kernel';
import type { ShareUnits } from '../../catalog/domain/share-option';

export type GroupStatus = 'open' | 'success' | 'failed';

export interface SalePolicySnapshot {
  originalPriceFen: number;
  userWholePriceFen: number;
  allowedShareUnits: ShareUnits[];
  wholeQuantityText: string;
  unit: string;
}

export interface GroupState {
  groupId: string;
  productId: string;
  snapshot: SalePolicySnapshot;
  deadline: Date;
  status: GroupStatus;
  paidUnits: number;
  reservedUnits: number;
  paidAmountFen: number;
  paidGoodsAmountFen: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 拼单组聚合根：容量 60 单位，快照固化（D003），60 支付单位才成功（AGENTS 不变量）。 */
export class Group {
  private constructor(readonly state: GroupState) {}

  static create(input: { groupId?: string; productId: string; snapshot: SalePolicySnapshot; deadline: Date; now: Date }): Group {
    if (!Array.isArray(input.snapshot.allowedShareUnits) || input.snapshot.allowedShareUnits.length === 0) {
      throw new ApplicationError('VALIDATION_FAILED', '组快照份额集合不能为空');
    }
    if (!(input.deadline > input.now)) throw new ApplicationError('VALIDATION_FAILED', '组截止时间必须晚于创建时间');
    return new Group({
      groupId: input.groupId ?? crypto.randomUUID(),
      productId: input.productId,
      snapshot: { ...input.snapshot, allowedShareUnits: [...input.snapshot.allowedShareUnits] },
      deadline: input.deadline,
      status: 'open',
      paidUnits: 0,
      reservedUnits: 0,
      paidAmountFen: 0,
      paidGoodsAmountFen: 0,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  static rehydrate(state: GroupState): Group {
    return new Group({ ...state, snapshot: { ...state.snapshot, allowedShareUnits: [...state.snapshot.allowedShareUnits] } });
  }

  get isOpen(): boolean {
    return this.state.status === 'open';
  }

  get remainingCapacity(): number {
    return 60 - this.state.paidUnits - this.state.reservedUnits;
  }

  withReservedUnits(units: number): Group {
    if (!this.isOpen) throw new ApplicationError('GROUP_NOT_JOINABLE', '拼单组已结束，无法加入');
    const after = this.state.reservedUnits + units;
    if (!Number.isInteger(units) || units < 1 || after > 60) {
      throw new ApplicationError('SHARE_CAPACITY_CONFLICT', '份额容量竞争失败，请重试');
    }
    return new Group({ ...this.state, reservedUnits: after, updatedAt: this.state.updatedAt });
  }

  /** 支付生效：预占单位转正（paid+units，reserved−units），总占用不变。units 可为 0（无预占转正的纯金额更新场景，如迟到支付记录）。 */
  withPaidUnits(units: number, now: Date): Group {
    if (!this.isOpen) throw new ApplicationError('GROUP_NOT_JOINABLE', '拼单组已结束');
    const paid = this.state.paidUnits + units;
    const reserved = this.state.reservedUnits - units;
    if (!Number.isInteger(units) || units < 0 || paid > 60 || reserved < 0) {
      throw new ApplicationError('SHARE_CAPACITY_CONFLICT', '份额容量竞争失败');
    }
    return new Group({ ...this.state, paidUnits: paid, reservedUnits: reserved, updatedAt: now });
  }

  andReserved(units: number): Group {
    return new Group({ ...this.state, reservedUnits: Math.max(0, this.state.reservedUnits - units), updatedAt: this.state.updatedAt });
  }

  /** 支付生效：记录已支付金额（预占→支付转换，不重复占容量）。 */
  withPaidAmount(amountFen: number, goodsFen: number, now: Date): Group {
    return new Group({
      ...this.state,
      paidAmountFen: this.state.paidAmountFen + amountFen,
      paidGoodsAmountFen: this.state.paidGoodsAmountFen + goodsFen,
      updatedAt: now
    });
  }

  /** 拼满判定：恰好 60 支付单位才允许成功（同事务原子调用）。 */
  markSuccess(now: Date): Group {
    if (this.state.status !== 'open') throw new ApplicationError('GROUP_NOT_JOINABLE', '拼单组已结束');
    if (this.state.paidUnits !== 60) throw new ApplicationError('VALIDATION_FAILED', '支付单位未满 60，不能判定拼单成功');
    return new Group({ ...this.state, status: 'success', reservedUnits: 0, updatedAt: now });
  }

  markFailed(now: Date): Group {
    if (this.state.status !== 'open') return this;
    return new Group({ ...this.state, status: 'failed', reservedUnits: 0, updatedAt: now });
  }
}
