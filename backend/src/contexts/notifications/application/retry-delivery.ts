import { ApplicationError } from '../../../shared/kernel';
import { assertManualRetryable } from '../domain/notification';
import type { DeliveryState, NotificationRepository } from './ports';
import type { Clock } from './record-notification';

export interface RetryDeliveryDeps {
  repository: NotificationRepository;
  audit: { execute(input: { adminId: string | null; action: string; resourceType: string; resourceId?: string; detail?: Record<string, unknown>; requestId?: string }, sessionTx?: unknown): Promise<void> };
  runner?: { run<T>(work: (tx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}

/** 管理员手工重试：仅 failed 可重置（409 语义 DELIVERY_NOT_RETRYABLE）；重试动作写审计。 */
export class RetryDelivery {
  constructor(private readonly deps: RetryDeliveryDeps) {}

  async execute(input: { deliveryId: string; adminId: string | null; requestId: string }): Promise<{ delivery: DeliveryState }> {
    const work = async (tx?: unknown): Promise<{ delivery: DeliveryState }> => {
    const found = await this.deps.repository.findDeliveryById(input.deliveryId, tx);
    if (!found) throw new ApplicationError('NOT_FOUND', '投递不存在');
    assertManualRetryable(found.delivery);
    const delivery = await this.deps.repository.resetDeliveryFailed(input.deliveryId, this.deps.clock.now(), tx);
    if (!delivery) throw new ApplicationError('DELIVERY_NOT_RETRYABLE', '投递状态已变化，请刷新后重试');
    await this.deps.audit.execute({
      adminId: input.adminId,
      action: 'notification.retry',
      resourceType: 'notification_delivery',
      resourceId: input.deliveryId,
      detail: { notificationId: found.notification.state.notificationId, channel: delivery.channel },
      requestId: input.requestId
    }, tx);
    return { delivery };
    };
    return this.deps.runner ? this.deps.runner.run(work) : work();
  }
}
