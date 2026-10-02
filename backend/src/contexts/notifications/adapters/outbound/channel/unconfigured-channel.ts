import type { DeliveryOutcome, NotificationChannelPort } from '../../../application/ports';

/**
 * D021：真实订阅消息渠道待小程序凭证（AppSecret/模板 ID/用户授权）接入，
 * 本适配器明确声明渠道未配置——投递记录以 skipped 留痕，验证管道而非冒充发送成功。
 */
export class UnconfiguredChannelAdapter implements NotificationChannelPort {
  readonly channel = 'wechat_subscribe_message';

  async send(): Promise<DeliveryOutcome> {
    return { outcome: 'skipped', reason: 'channel_not_configured' };
  }
}
