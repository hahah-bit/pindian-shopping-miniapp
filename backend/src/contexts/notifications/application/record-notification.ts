import { Notification } from '../domain/notification';
import type { NotificationRepository } from './ports';

export interface Clock { now(): Date }

export interface RecordNotificationInput {
  recipientAdminId?: string | null;
  recipientUserId?: string | null;
  eventType: string;
  title: string;
  body: string;
  reference?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface RecordNotificationResult {
  notification: Notification;
  /** true = 幂等命中已存在通知（不重复投递）。 */
  duplicated: boolean;
}

/** 通知写入用例：幂等键冲突返回已存在通知（语义为成功，不抛错）。 */
export class RecordNotification {
  constructor(private readonly deps: { repository: NotificationRepository; clock: Clock }) {}

  async execute(input: RecordNotificationInput): Promise<RecordNotificationResult> {
    const notification = Notification.create(input, this.deps.clock.now());
    const result = await this.deps.repository.insertIfAbsent(notification);
    return { notification: result.notification, duplicated: !result.created };
  }
}
