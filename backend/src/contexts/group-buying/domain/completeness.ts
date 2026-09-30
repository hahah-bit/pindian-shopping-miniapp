import { ApplicationError } from '../../../shared/kernel';

/** 组容量：一整件 = 60 单位。 */
export const GROUP_CAPACITY_UNITS = 60;

const VALID_UNITS: readonly number[] = [30, 20, 15, 12];

function normalizeAllowed(allowedUnits: readonly number[]): readonly number[] {
  if (!Array.isArray(allowedUnits) || allowedUnits.length === 0) {
    throw new ApplicationError('VALIDATION_FAILED', '允许份额集合不能为空');
  }
  for (const unit of allowedUnits) {
    if (typeof unit !== 'number' || !VALID_UNITS.includes(unit)) {
      throw new ApplicationError('VALIDATION_FAILED', '允许份额仅支持 60 单位制（30/20/15/12）');
    }
  }
  return allowedUnits;
}

/**
 * 可完成性表：dp[s] = 剩余 s 单位能否由 allowedUnits（可重复选取）精确凑出。
 * 整数动态规划，无浮点、无贪心（AGENTS §7.1）。
 */
export function buildCompletenessTable(allowedUnits: readonly number[]): boolean[] {
  const allowed = normalizeAllowed(allowedUnits);
  const dp: boolean[] = new Array(GROUP_CAPACITY_UNITS + 1).fill(false);
  dp[0] = true;
  for (let s = 1; s <= GROUP_CAPACITY_UNITS; s++) {
    for (const unit of allowed) {
      if (unit <= s && dp[s - unit]) {
        dp[s] = true;
        break;
      }
    }
  }
  return dp;
}

/** 组能否接受 myUnits 的加入：剩余>0、单位在快照集合内、加入后剩余仍可完成。 */
export function canJoinGroup(allowedUnits: readonly number[], table: readonly boolean[], remaining: number, myUnits: number): boolean {
  if (!Number.isInteger(remaining) || !Number.isInteger(myUnits) || remaining < 0 || myUnits < 1) return false;
  if (remaining === 0) return false;
  if (!normalizeAllowed(allowedUnits).includes(myUnits)) return false;
  if (myUnits > remaining) return false;
  return table[remaining - myUnits] === true;
}

/** 剩余容量 = 60 − 已支付 − 有效预占。 */
export function remainingCapacity(paidUnits: number, reservedUnits: number): number {
  if (!Number.isInteger(paidUnits) || !Number.isInteger(reservedUnits) || paidUnits < 0 || reservedUnits < 0) {
    throw new ApplicationError('VALIDATION_FAILED', '份额占用数据非法');
  }
  const remaining = GROUP_CAPACITY_UNITS - paidUnits - reservedUnits;
  if (remaining < 0) throw new ApplicationError('VALIDATION_FAILED', '份额占用超过组容量');
  return remaining;
}
