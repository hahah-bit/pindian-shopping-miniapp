import { ApplicationError } from '../../../shared/kernel';

export interface AllocationInput {
  orderId: string;
  units: number;
}

export interface AllocationResult {
  orderId: string;
  grams: number;
}

/**
 * 最小履约单位（D011 已确认，2026-10-01，独立审查 R01 单位注册表）：
 * - 重量单位按克（斤=500、千克/kg=1000、克/g=1、两=50）；
 * - 计数单位按整件（数量必须整数）；
 * - 其他单位返回 null（生成时拒绝并留痕，不静默缩减商品支持范围）。
 */
export const GRAMS_PER_JIN = 500;

const WEIGHT_UNITS_TO_GRAMS: Readonly<Record<string, number>> = {
  斤: 500,
  千克: 1000,
  kg: 1000,
  克: 1,
  g: 1,
  两: 50
};

const COUNTABLE_UNITS: ReadonlySet<string> = new Set([
  '个', '件', '只', '盒', '箱', '瓶', '包', '袋', '桶', '罐', '台', '部', '张', '支', '枚', '本', '册', '副', '套'
]);

export interface MinimalUnits {
  units: number;
  kind: 'weight' | 'countable';
}

/** 快照数量文本 + 单位 → 最小履约单位数；不可履约（未知单位/非整数换算/非正数）返回 null。 */
export function toMinimalUnits(wholeQuantityText: string, unit: string): MinimalUnits | null {
  const value = Number(wholeQuantityText);
  if (!Number.isFinite(value) || value <= 0) return null;
  const normalizedUnit = (unit ?? '').trim();
  const gramsPerUnit = WEIGHT_UNITS_TO_GRAMS[normalizedUnit];
  if (gramsPerUnit !== undefined) {
    const units = value * gramsPerUnit;
    if (!Number.isInteger(units) || units <= 0) return null;
    return { units, kind: 'weight' };
  }
  if (COUNTABLE_UNITS.has(normalizedUnit)) {
    if (!Number.isInteger(value) || value <= 0) return null;
    return { units: value, kind: 'countable' };
  }
  return null;
}

/** 最小单位数 → 原单位展示文本（重量 3 位小数，计数/克为整数）。 */
export function formatQuantity(minimalUnits: number, unit: string): string {
  const normalizedUnit = (unit ?? '').trim();
  const gramsPerUnit = WEIGHT_UNITS_TO_GRAMS[normalizedUnit];
  if (gramsPerUnit !== undefined && normalizedUnit !== '克' && normalizedUnit !== 'g') {
    return (Math.round((minimalUnits / gramsPerUnit) * 1000) / 1000).toFixed(3);
  }
  return String(minimalUnits);
}

/**
 * 数量分配（D011 已确认，纯函数）：
 * base_i = floor(totalUnits × units_i / 60)；余数 R = totalUnits − Σbase_i（0 ≤ R < n），
 * 按传入顺序（订单创建序）给前 R 单各 +1。
 * 守恒：Σ = totalUnits（测试含证明性用例）。参数名 grams 沿用历史（实际为最小履约单位数）。
 */
export function allocateQuantity(totalGrams: number, orders: AllocationInput[]): AllocationResult[] {
  if (!Number.isInteger(totalGrams) || totalGrams <= 0) throw new ApplicationError('VALIDATION_FAILED', '整件数量必须为正整数（最小履约单位）');
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
 * @deprecated R01：换算必须依赖商品单位（toMinimalUnits）——此函数一律 ×500，
 * 会把「10 克」当「10 斤」换算成 5000。
 */
export function wholeQuantityToGrams(wholeQuantityText: string): number | null {
  const value = Number(wholeQuantityText);
  if (!Number.isFinite(value) || value <= 0) return null;
  const grams = value * GRAMS_PER_JIN;
  if (!Number.isInteger(grams)) return null;
  return grams;
}

/** 克 → 斤展示文本（3 位小数 half-up）。@deprecated 使用 formatQuantity（按原快照单位）。 */
export function gramsToJinText(grams: number): string {
  return (Math.round((grams / GRAMS_PER_JIN) * 1000) / 1000).toFixed(3);
}
