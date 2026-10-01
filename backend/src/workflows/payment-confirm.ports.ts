import type { StockReservationPort } from './order-place.workflow';

/** 退款创建端口（Payments 上下文实现，F022）。 */
/** 退款创建端口（Payments 上下文实现，F022）；sessionTx 用于与外层事务同事务建单（复验 A03/R4）。 */
export interface RefundCreationPort {
  createFullRefund(input: { paymentId: string; orderId: string; userId: string; amountFen: number; reason: 'user_cancel' | 'group_failed' | 'late_payment' }, sessionTx?: unknown): Promise<{ refundId: string }>;
}

export type { StockReservationPort };
