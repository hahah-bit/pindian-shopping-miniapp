import { ApplicationError } from '../../../shared/kernel';

export type DeliveryStatusValue = 'pending' | 'sent' | 'skipped' | 'failed';

export const DEFAULT_DELIVERY_CHANNEL = 'wechat_subscribe_message';

export interface DeliveryState {
  deliveryId: string | null;
  notificationId: string | null;
  channel: string;
  status: DeliveryStatusValue;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  skippedReason: string | null;
  updatedAt: Date | null;
}

export interface NotificationState {
  notificationId: string | null;
  recipientAdminId: string | null;
  recipientUserId: string | null;
  eventType: string;
  title: string;
  body: string;
  reference: Record<string, unknown>;
  idempotencyKey: string;
  readAt: Date | null;
  createdAt: Date | null;
  deliveries: DeliveryState[];
}

export interface CreateNotificationInput {
  notificationId?: string;
  recipientAdminId?: string | null;
  recipientUserId?: string | null;
  eventType: string;
  title: string;
  body: string;
  reference?: Record<string, unknown>;
  idempotencyKey: string;
}

/** 投递尝试结果（渠道端口返回）。 */
export type DeliveryOutcome =
  | { outcome: 'sent' }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'failed'; error: string };

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * 通知记录聚合（T009/F038）：一个接收者一条通知，聚合内管理各渠道投递。
 * 不变量见 T009 ddd §4：I1 幂等键（由仓储唯一约束兜底）、I2 接收者恰一、I3 已读仅本人且幂等、I4 状态机、I5/I6 重试边界。
 */
export class Notification {
  readonly state: NotificationState;

  constructor(state: NotificationState) {
    this.state = state;
  }

  static create(input: CreateNotificationInput, now: Date): Notification {
    const recipientAdminId = input.recipientAdminId ?? null;
    const recipientUserId = input.recipientUserId ?? null;
    if ((recipientAdminId === null) === (recipientUserId === null)) {
      throw new ApplicationError('VALIDATION_FAILED', '通知接收者必须为用户或管理员恰一');
    }
    const eventType = input.eventType.trim();
    if (!eventType || eventType.length > 64) throw new ApplicationError('VALIDATION_FAILED', '事件类型不能为空且不超过 64 字符');
    const title = input.title.trim();
    if (!title || title.length > 120) throw new ApplicationError('VALIDATION_FAILED', '通知标题不能为空且不超过 120 字符');
    const body = input.body.trim();
    if (!body || body.length > 500) throw new ApplicationError('VALIDATION_FAILED', '通知正文不能为空且不超过 500 字符');
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) throw new ApplicationError('VALIDATION_FAILED', '幂等键不能为空且不超过 128 字符');
    const delivery: DeliveryState = {
      deliveryId: null,
      notificationId: null,
      channel: DEFAULT_DELIVERY_CHANNEL,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 5,
      lastError: null,
      nextAttemptAt: null,
      sentAt: null,
      skippedReason: null,
      updatedAt: now
    };
    return new Notification({
      notificationId: input.notificationId ?? null,
      recipientAdminId,
      recipientUserId,
      eventType,
      title,
      body,
      reference: input.reference ?? {},
      idempotencyKey,
      readAt: null,
      createdAt: now,
      deliveries: [delivery]
    });
  }

  /** 已读：仅接收者本人；幂等保留首次时间。 */
  markRead(userId: string, now: Date): void {
    if (this.state.recipientUserId !== userId) throw new ApplicationError('NOT_FOUND', '通知不存在');
    if (this.state.readAt === null) this.state.readAt = now;
  }
}

/** 状态机：pending→sent/skipped/failed；failed 按退避 2^n 分钟重试，达上限后 nextAttemptAt=null（仅可手工重试唤醒）。 */
export function recordDeliveryAttempt(delivery: DeliveryState, result: DeliveryOutcome, now: Date): void {
  if (delivery.status === 'sent' || delivery.status === 'skipped') {
    throw new ApplicationError('CONFLICT', '终态投递不能再记录尝试');
  }
  delivery.updatedAt = now;
  if (result.outcome === 'sent') {
    delivery.status = 'sent';
    delivery.sentAt = now;
    delivery.nextAttemptAt = null;
    delivery.lastError = null;
    return;
  }
  if (result.outcome === 'skipped') {
    delivery.status = 'skipped';
    delivery.skippedReason = truncate(result.reason, 64);
    delivery.nextAttemptAt = null;
    return;
  }
  delivery.status = 'failed';
  delivery.attemptCount += 1;
  delivery.lastError = truncate(result.error, 500);
  delivery.nextAttemptAt = delivery.attemptCount >= delivery.maxAttempts ? null : new Date(now.getTime() + 2 ** delivery.attemptCount * 60_000);
}

/** 手工重试：仅 failed 可重置；pending/sent/skipped 抛 DELIVERY_NOT_RETRYABLE。 */
export function assertManualRetryable(delivery: DeliveryState): void {
  if (delivery.status !== 'failed') {
    throw new ApplicationError('DELIVERY_NOT_RETRYABLE', '仅失败投递可以手工重试');
  }
}

export function resetDeliveryForManualRetry(delivery: DeliveryState, now: Date): void {
  assertManualRetryable(delivery);
  delivery.status = 'pending';
  delivery.attemptCount = 0;
  delivery.lastError = null;
  delivery.nextAttemptAt = null;
  delivery.updatedAt = now;
}
