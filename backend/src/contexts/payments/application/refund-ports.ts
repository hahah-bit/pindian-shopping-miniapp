import { ApplicationError, type Clock } from '../../../shared/kernel';
import { Refund, MAX_REFUND_RETRIES } from '../domain/refund';
import type { PaymentRepository, PaymentChannelPort } from './ports';

export interface RefundRepositoryPort {
  insert(refund: Refund, sessionTx?: unknown): Promise<void>;
  findByPaymentId(paymentId: string): Promise<Refund[]>;
  findById(refundId: string): Promise<Refund | null>;
  save(refund: Refund, sessionTx?: unknown): Promise<void>;
  findByOutRefundNo(outRefundNo: string): Promise<Refund | null>;
  findRefundDueForSubmit(now: Date, limit: number): Promise<Refund[]>;
  findRefundDueForQuery(now: Date, limit: number): Promise<Refund[]>;
  listAdmin(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: Refund[]; total: number }>;
}

export interface RefundsDeps {
  refunds: RefundRepositoryPort;
  payments: PaymentRepository;
  channel: PaymentChannelPort;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}
