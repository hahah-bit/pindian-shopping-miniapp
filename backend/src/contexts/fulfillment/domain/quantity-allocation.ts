import { ApplicationError } from '../../../shared/kernel';

export interface AllocationInput {
  orderId: string;
  units: number;
}

export interface AllocationResult {
  orderId: string;
  grams: number;
}

/** 1 斤 = 500 克（整数克为履约最小单位，D011）。 */
export const GRAMS_PER_JIN = 500;

/**
 * 数量分配（D011，纯函数）：
 * base_i = floor(totalG × units_i / 60)；余数 R = totalG − Σbase_i（0 ≤ R < n），
 * 按传入顺序（订单创建序）给前 R 单各 +1 g。
 * 守恒：Σgrams = totalG（测试含证明性用例）。
 */
export function allocateQuantity(totalGrams: number, orders: AllocationInput[]): AllocationResult[] {
  if (!Number.isInteger(totalGrams) || totalGrams <= 0) throw new ApplicationError('VALIDATION_FAILED', '整件克数必须为正整数');
  if (!Array.isArray(orders) || orders.length === 0) throw new ApplicationError('VALIDATION_FAILED', '订单列表为空');
  const totalUnits = orders.reduce((sum, o) => sum + o.units, 0);
  if (totalUnits !== 60) throw new ApplicationError('VALIDATION_FAILED', `份额合计必须为 60，实际 ${totalUnits}`);

  const bases = orders.map((o) => Math.floor((totalGrams * o.units) / 60));
  let remainder = totalGrams - bases.reduce((sum, b) => sum + b, 0);
  return orders.map((o, i) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    const base = bases[i] ?? 0;
    return { orderId: o.orderId, grams: base + extra };
  });
}

/**
 * 斤文本（≤3 位小数）→ 整数克；非数值、非正数或乘积非整数克（如 0.001 斤 = 0.5g）返回 null
 * ——此类商品无法精确履约，生成阶段拒绝并留痕。
 */
export function wholeQuantityToGrams(wholeQuantityText: string): number | null {
  const value = Number(wholeQuantityText);
  if (!Number.isFinite(value) || value <= 0) return null;
  const grams = value * GRAMS_PER_JIN;
  if (!Number.isInteger(grams)) return null;
  return grams;
}

/** 克 → 斤展示文本（3 位小数 half-up）。 */
export function gramsToJinText(grams: number): string {
  return (Math.round((grams / GRAMS_PER_JIN) * 1000) / 1000).toFixed(3);
}
