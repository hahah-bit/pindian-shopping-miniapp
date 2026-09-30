import type { Order } from '../domain/order';

export interface OrderRepository {
  findByIdempotencyKey(userId: string, key: string): Promise<Order | null>;
  findById(orderId: string): Promise<Order | null>;
  insert(order: Order, sessionTx?: unknown): Promise<void>;
  save(order: Order, sessionTx?: unknown): Promise<void>;
  /** 到期/取消条件迁移：仅 unpaid 生效，返回是否迁移（幂等由调用方保证）。 */
  transitionIfUnpaid?(orderId: string, next: 'cancelled' | 'expired', now: Date, sessionTx?: unknown): Promise<boolean>;
  listByUser(userId: string, page: number, pageSize: number): Promise<{ items: Order[]; total: number }>;
  listAdmin(query: { status?: string | null; keyword?: string | null; page: number; pageSize: number }): Promise<{ items: Order[]; total: number }>;
}
