import type { Notification, DeliveryState, DeliveryOutcome } from '../domain/notification';

export type { DeliveryOutcome, DeliveryState };

/** 通知聚合仓储（含投递实体的持久化与条件更新）。 */
export interface NotificationRepository {
  /** 幂等插入：键冲突时返回已存在通知（created=false）。 */
  insertIfAbsent(notification: Notification): Promise<{ created: boolean; notification: Notification }>;
  findById(notificationId: string): Promise<Notification | null>;
  /** 认领到期投递（租约式，FOR UPDATE SKIP LOCKED 防并发重复驱动），连同所属通知一并返回。 */
  claimDueDeliveries(limit: number, now: Date, leaseMinutes: number): Promise<Array<{ delivery: DeliveryState; notification: Notification }>>;
  saveDelivery(delivery: DeliveryState): Promise<void>;
  findDeliveryById(deliveryId: string, sessionTx?: unknown): Promise<{ delivery: DeliveryState; notification: Notification } | null>;
  /** 条件重置：仅 failed 生效；返回 null 表示状态已变（并发冲突）。 */
  resetDeliveryFailed(deliveryId: string, now: Date, sessionTx?: unknown): Promise<DeliveryState | null>;
  listDeliveries(query: { status?: string | null; channel?: string | null; eventType?: string | null; page: number; pageSize: number }): Promise<{ items: Array<{ delivery: DeliveryState; notification: Notification; recipientType: 'admin' | 'user'; recipientName: string }>; total: number }>;
  listUserNotifications(userId: string, page: number, pageSize: number): Promise<{ items: Notification[]; total: number; unreadCount: number }>;
  findUserNotification(notificationId: string, userId: string): Promise<Notification | null>;
  markRead(notificationId: string, userId: string, now: Date): Promise<void>;
}

/** 外发渠道端口（D021）：本轮唯一实现为未配置渠道适配器；真实订阅消息适配器待凭证另接。 */
export interface NotificationChannelPort {
  readonly channel: string;
  send(input: { notification: Notification; delivery: DeliveryState }): Promise<DeliveryOutcome>;
}

/** 客服超时扫描（D022）：对 CustomerService/IdentityAccess 事实的只读查询。 */
export interface CsTimeoutScanPort {
  findOverdueConversations(thresholdMinutes: number, limit: number, recipientAdminIds?: string[]): Promise<Array<{ conversationId: string; userId: string; createdAt: Date }>>;
  findOnlineSupervisors(onlineWindowSeconds: number): Promise<Array<{ adminId: string; displayName: string }>>;
  listActiveSupervisors(): Promise<Array<{ adminId: string; displayName: string }>>;
}

/** 业务事件补抓扫描（D026）：对 Payments/GroupBuying 事实的只读查询，按幂等键增量补通知。 */
export interface BusinessEventScanPort {
  findSucceededRefundsWithoutNotification(limit: number): Promise<Array<{ refundId: string; orderId: string; userId: string; amountFen: number }>>;
  findSuccessGroupOrdersWithoutNotification(limit: number): Promise<Array<{ orderId: string; userId: string; groupId: string }>>;
}
