/** 金额展示格式化：整数分 → "x.xx"；纯字符串运算，不引入浮点参与计算。 */
export function formatFen(fen: number): string {
  const sign = fen < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(fen));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** 数量展示：直接透出后端字符串（后端已保证 ≤3 位小数）。 */
export function formatQuantity(quantityText: string, unit: string): string {
  return `${quantityText} ${unit}`;
}
