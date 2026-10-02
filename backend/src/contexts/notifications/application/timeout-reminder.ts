import type { CsTimeoutScanPort } from './ports';
import type { RecordNotification } from './record-notification';
import type { Clock } from './record-notification';

/**
 * D022 客服超时提醒：扫描超阈值未获客服可见回复的进行中会话，对在线客服主管按
 * 「会话×主管」幂等生成提醒通知；无在线主管时落给全部 active 主管留痕。不转派、不改分配。
 */
export class ScanTimeoutConversations {
  constructor(private readonly deps: { scanPort: CsTimeoutScanPort; recorder: RecordNotification; clock: Clock; thresholdMinutes: number }) {}

  async execute(input: { limit?: number } = {}): Promise<{ scanned: number; created: number }> {
    const limit = input.limit ?? 100;
    let recipients = await this.deps.scanPort.findOnlineSupervisors(60);
    if (recipients.length === 0) recipients = await this.deps.scanPort.listActiveSupervisors();
    if (recipients.length === 0) return { scanned: 0, created: 0 };
    const overdue = await this.deps.scanPort.findOverdueConversations(this.deps.thresholdMinutes, limit, recipients.map((r) => r.adminId));
    let created = 0;
    for (const conversation of overdue) {
      for (const recipient of recipients) {
        const result = await this.deps.recorder.execute({
          recipientAdminId: recipient.adminId,
          eventType: 'cs.conversation.timeout',
          title: '会话超时提醒',
          body: `会话 ${conversation.conversationId.slice(0, 8)} 超过 ${this.deps.thresholdMinutes} 分钟未回复，请关注`,
          reference: { conversationId: conversation.conversationId, userId: conversation.userId },
          idempotencyKey: `cs.conversation.timeout:${conversation.conversationId}:${recipient.adminId}`
        });
        if (!result.duplicated) created += 1;
      }
    }
    return { scanned: overdue.length, created };
  }
}
