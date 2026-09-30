import { ApplicationError } from '../../../shared/kernel';
import { SHARE_DENOMINATOR } from './share-option';

/** 平台服务费：固定 500 分，不可配置（AGENTS 已确认规则）。 */
export const SERVICE_FEE_FEN = 500;
export const MAX_ORIGINAL_PRICE_FEN = 99_999_999;

export function validateOriginalPriceFen(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > MAX_ORIGINAL_PRICE_FEN) {
    throw new ApplicationError('VALIDATION_FAILED', `整件商品原价必须为 1-${MAX_ORIGINAL_PRICE_FEN} 的整数分`);
  }
  return input;
}

/** 用户端整件参考售价 = 原价 + 固定服务费。 */
export function userWholePriceFen(originalPriceFen: number): number {
  return originalPriceFen + SERVICE_FEE_FEN;
}

/**
 * 参考份额价（half-up 到分，纯整数运算）。
 * 仅用于展示；正式支付报价与尾差分摊规则由后续交易任务定义。
 */
export function referenceSharePriceFen(originalPriceFen: number, units: number): number {
  const total = userWholePriceFen(originalPriceFen) * units;
  return Math.floor((total + SHARE_DENOMINATOR / 2) / SHARE_DENOMINATOR);
}

/** 份额对应数量（毫单位，half-up 到 0.001）。展示舍入，非履约规则。 */
export function shareQuantityMilli(wholeQuantityMilli: number, units: number): number {
  return Math.floor((wholeQuantityMilli * units + SHARE_DENOMINATOR / 2) / SHARE_DENOMINATOR);
}
