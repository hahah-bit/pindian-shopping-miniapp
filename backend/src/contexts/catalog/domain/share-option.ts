import { ApplicationError } from '../../../shared/kernel';

/** 一整件 = 60 个份额单位（AGENTS 已确认规则）。 */
export const SHARE_DENOMINATOR = 60;
export const VALID_SHARE_UNITS = [30, 20, 15, 12] as const;
export type ShareUnits = (typeof VALID_SHARE_UNITS)[number];

const LABELS: Record<number, string> = { 30: '1/2', 20: '1/3', 15: '1/4', 12: '1/5' };

export function shareLabel(units: number): string {
  return LABELS[units] ?? `${units}/${SHARE_DENOMINATOR}`;
}

/** 规范化为合法份额子集（去重、按固定顺序 [1/2,1/3,1/4,1/5] 输出）。 */
export function normalizeShareUnits(input: unknown): ShareUnits[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ApplicationError('VALIDATION_FAILED', '至少配置一个允许份额');
  }
  const units = input.map((value) => (typeof value === 'string' ? Number(value) : value));
  const valid = new Set<number>();
  for (const value of units) {
    if (typeof value !== 'number' || !Number.isInteger(value) || !(VALID_SHARE_UNITS as readonly number[]).includes(value)) {
      throw new ApplicationError('VALIDATION_FAILED', '份额选项仅允许 1/2、1/3、1/4、1/5');
    }
    valid.add(value);
  }
  return VALID_SHARE_UNITS.filter((units2) => valid.has(units2));
}
