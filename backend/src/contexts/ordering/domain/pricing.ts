import { ApplicationError } from '../../../shared/kernel';

/** 平台服务费：固定 500 分（不可配置，AGENTS 已确认）。 */
export const SERVICE_FEE_FEN = 500;

export interface Quote {
  totalAmountFen: number;
  goodsAmountFen: number;
  serviceFeeFen: number;
  tailAdjustFen: number;
  isFinalOrder: boolean;
}

/**
 * 报价（D001 已确认）：
 * 通用价 = half-up((P+500)×units/60)；最后单（恰好填满组）= 整件价 − 组内已生效合计，
 * 商品部分同理补差，服务费为差额——保证组成功时 Σtotal=整件价、Σgoods=P、Σservice=500。
 */
export function computeQuote(input: {
  originalPriceFen: number;
  units: number;
  isFinalOrder: boolean;
  groupPaidAmountFen: number;
  groupPaidGoodsFen: number;
}): Quote {
  const { originalPriceFen, units, isFinalOrder } = input;
  if (!Number.isInteger(originalPriceFen) || originalPriceFen < 1) throw new ApplicationError('VALIDATION_FAILED', '商品原价非法');
  if (!Number.isInteger(units) || ![30, 20, 15, 12].includes(units)) throw new ApplicationError('VALIDATION_FAILED', '份额单位非法');
  const whole = originalPriceFen + SERVICE_FEE_FEN;
  const standard = Math.floor((whole * units + 30) / 60);
  const standardGoods = Math.floor((originalPriceFen * units + 30) / 60);
  if (!isFinalOrder) {
    return { totalAmountFen: standard, goodsAmountFen: standardGoods, serviceFeeFen: standard - standardGoods, tailAdjustFen: 0, isFinalOrder: false };
  }
  const total = whole - input.groupPaidAmountFen;
  const goods = originalPriceFen - input.groupPaidGoodsFen;
  if (!Number.isInteger(total) || !Number.isInteger(goods) || total < 0 || goods < 0) {
    throw new ApplicationError('VALIDATION_FAILED', '尾差计算结果非法，请重新下单');
  }
  return { totalAmountFen: total, goodsAmountFen: goods, serviceFeeFen: total - goods, tailAdjustFen: total - standard, isFinalOrder: true };
}
