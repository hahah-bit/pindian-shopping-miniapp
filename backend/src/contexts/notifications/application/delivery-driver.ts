import { recordDeliveryAttempt } from '../domain/notification';
import type { DeliveryOutcome, NotificationChannelPort, NotificationRepository } from './ports';
import type { Clock } from './record-notification';

/** 投递驱动任务：认领到期投递（租约+SKIP LOCKED 防并发）→ 渠道发送 → 落状态；失败按退避重试至上限。 */
export class DriveDeliveries {
  private readonly repository: NotificationRepository;
  private readonly channels: Map<string, NotificationChannelPort>;
  private readonly clock: Clock;

  constructor(deps: { repository: NotificationRepository; channels: NotificationChannelPort[]; clock: Clock }) {
    this.repository = deps.repository;
    this.channels = new Map(deps.channels.map((c) => [c.channel, c]));
    this.clock = deps.clock;
  }

  async execute(input: { limit: number }): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
    const now = this.clock.now();
    const claimed = await this.repository.claimDueDeliveries(input.limit, now, 5);
    const tally = { processed: 0, sent: 0, skipped: 0, failed: 0 };
    for (const { delivery, notification } of claimed) {
      const channel = this.channels.get(delivery.channel);
      let outcome: DeliveryOutcome;
      if (!channel) {
        outcome = { outcome: 'failed', error: 'channel_adapter_missing' };
      } else {
        try {
          outcome = await channel.send({ notification, delivery });
        } catch (error) {
          outcome = { outcome: 'failed', error: error instanceof Error ? error.message : String(error) };
        }
      }
      recordDeliveryAttempt(delivery, outcome, this.clock.now());
      await this.repository.saveDelivery(delivery);
      tally.processed += 1;
      tally[outcome.outcome] += 1;
    }
    return tally;
  }
}
