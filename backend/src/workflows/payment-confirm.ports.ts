import type { StockReservationPort } from './order-place.workflow';

/** 退款创建端口（Payments 上下文实现，F022）。 */
export interface RefundCreationPort {
  createFullRefund(input: { paymentId: string; orderId: string; userId: string; amountFen: number; reason: 'user_cancel' | 'group_failed' | 'late_payment' }): Promise<{ refundId: string }>;
}

export type { StockReservationPort };
