import { ApplicationError } from '../../../shared/kernel';

/** 数量上限：999999999，3 位小数（毫单位）。 */
export const MAX_QUANTITY_MILLI = 999_999_999_000;
const QUANTITY_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

/** 十进制数量值对象：字符串进出、整数毫单位运算，禁止浮点。 */
export class Quantity {
  private constructor(readonly text: string, readonly milli: number) {}

  static parse(input: unknown): Quantity {
    if (typeof input !== 'string' || !QUANTITY_PATTERN.test(input)) {
      throw new ApplicationError('VALIDATION_FAILED', '数量必须为不超过 3 位小数的正数，如 10 或 9.5');
    }
    return Quantity.fromMilli(Quantity.toMilli(input));
  }

  private static toMilli(text: string): number {
    const [intPart, decimalPart = ''] = text.split('.');
    const padded = decimalPart.padEnd(3, '0');
    return Number(intPart) * 1000 + Number(padded || '0');
  }

  static fromMilli(milli: number): Quantity {
    if (!Number.isInteger(milli) || milli <= 0 || milli > MAX_QUANTITY_MILLI) {
      throw new ApplicationError('VALIDATION_FAILED', '数量必须为大于 0 且不超过 999999999 的数值');
    }
    const intPart = Math.floor(milli / 1000);
    const decimal = milli % 1000;
    const decimalText = decimal === 0 ? '' : `.${String(decimal).padStart(3, '0').replace(/0+$/, '')}`;
    return new Quantity(`${intPart}${decimalText}`, milli);
  }
}

/** 毫单位 → 展示字符串（去尾零）。 */
export function formatMilli(milli: number): string {
  return Quantity.fromMilli(milli).text;
}
