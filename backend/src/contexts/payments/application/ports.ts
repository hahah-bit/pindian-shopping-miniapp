import { ApplicationError, type Clock } from '../../../shared/kernel';
import { Payment } from '../domain/payment';

export interface PaymentChannelPort {
  createJsapiOrder(input: { outTradeNo: string; amountFen: number; openid: string; description: string; notifyUrl: string }): Promise<{ prepayId: string }>;
  /** 调起支付 paySign 签名（商户私钥 RSA；实现于微信适配器，测试替身返回占位）。 */
  signPayParams?(prepayPackage: string): string;
  queryOrderByOutTradeNo(outTradeNo: string): Promise<{ tradeState: string; transactionId?: string; payerTotal?: number }>;
  closeOrder(outTradeNo: string): Promise<void>;
  submitRefund(input: { outTradeNo: string; outRefundNo: string; refundFen: number; totalFen: number; reason: string }): Promise<{ status: string; refundId?: string }>;
  queryRefund(outRefundNo: string): Promise<{ status: string; refundId?: string }>;
}

export interface PayConfigPort {
  configured: boolean;
  notifyUrl: string;
}

export interface OrderForPaymentState {
  orderId: string;
  userId: string;
  status: string;
  totalAmountFen: number;
  units: number;
  groupId: string;
  reservationExpiresAt: Date;
}

export interface OrderPaymentRepository {
  findById(orderId: string): Promise<OrderForPaymentState | null>;
}

export interface GroupPayabilityPort {
  isJoinable(groupId: string): Promise<boolean>;
}

export interface PaymentRepository {
  insert(payment: Payment): Promise<void>;
  findByOrderId(orderId: string): Promise<Payment | null>;
  findById(paymentId: string): Promise<Payment | null>;
  save(payment: Payment): Promise<void>;
  /** 查询补偿：超静默期未更新的 processing/unknown 单。 */
  findStale(now: Date, limit: number): Promise<Payment[]>;
  /** 后台异常统计。 */
  countByStatus(status: 'pending_review' | 'processing' | 'unknown'): Promise<number>;
  listAdmin(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: Payment[]; total: number }>;
}

export interface UserOpenidPort {
  getOpenid(userId: string): Promise<string | null>;
}

export interface InitiatePaymentDeps {
  orders: OrderPaymentRepository;
  groups: GroupPayabilityPort;
  payments: PaymentRepository;
  channel: PaymentChannelPort;
  users: UserOpenidPort;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
  payConfig: PayConfigPort;
}
