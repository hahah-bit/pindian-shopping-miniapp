import { fetchMessages, getCurrentConversation, sendText, endConversation } from '../../../../platform/cs-api';
import { UserAuthExpiredError } from '../../../../platform/user-auth';

/** 客服会话页（F035）：2s 轮询增量拉取（D016）；发送以 clientMessageId 幂等。 */

let pollTimer: number | null = null;

Page({
  data: {
    loading: true,
    error: '',
    conversationId: '',
    status: '' as string,
    hasAgent: false,
    messages: [] as Array<{ seq: number; self: boolean; text: string; timeText: string }>,
    input: '',
    sending: false,
    scrollInto: ''
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ conversationId: query.id ?? '' });
    void this.bootstrap();
  },

  onUnload() {
    if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  },

  async bootstrap() {
    this.setData({ loading: true, error: '' });
    try {
      const conv = await getCurrentConversation();
      if (!conv.conversation || conv.conversation.id !== this.data.conversationId) {
        // 会话已结束/转工单：仍尝试拉历史
        this.setData({ status: 'ended' });
      } else {
        this.setData({ status: conv.conversation.status, hasAgent: conv.conversation.hasAgent });
      }
      await this.pull(true);
      this.setData({ loading: false });
      this.startPolling();
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
      this.setData({ loading: false, error: cause instanceof Error ? cause.message : '加载失败' });
    }
  },

  startPolling() {
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => void this.pull(false), 2000);
  },

  async pull(initial: boolean) {
    if (!this.data.conversationId) return;
    try {
      const existing = this.data.messages;
      const lastMsg = existing[existing.length - 1];
      const lastSeq = lastMsg ? lastMsg.seq : 0;
      const result = await fetchMessages(this.data.conversationId, lastSeq);
      if (result.messages.length) {
        const append = result.messages.map((m) => ({
          seq: m.seq,
          self: m.sender === 'user',
          text: m.kind === 'image' ? '[图片]' : m.kind === 'card' ? `[卡片:${(m.content as { cardKind?: string }).cardKind ?? ''}]` : String((m.content as { text?: string }).text ?? ''),
          timeText: new Date(m.createdAt).toLocaleTimeString()
        }));
        const merged = [...existing, ...append];
        const last = merged[merged.length - 1];
        if (last) this.setData({ messages: merged, scrollInto: `msg-${last.seq}` });
      }
      // 状态同步（ended/converted 时停止轮询）
      if (!initial && !this.data.messages.length && result.lastSeq === 0 && this.data.status === '') {
        this.setData({ status: 'ended' });
        if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
      }
    } catch {
      // 轮询失败静默，下轮重试（UI 不闪烁）
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    this.setData({ input: e.detail.value });
  },

  async send() {
    const text = this.data.input.trim();
    if (!text || this.data.sending || !this.data.conversationId) return;
    this.setData({ sending: true });
    try {
      await sendText(this.data.conversationId, text);
      this.setData({ input: '' });
      await this.pull(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '发送失败';
      wx.showToast({ title: message, icon: 'none' });
      if (message.includes('已结束')) {
        this.setData({ status: 'ended' });
        if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
      }
    } finally {
      this.setData({ sending: false });
    }
  },

  async endSession() {
    if (!this.data.conversationId) return;
    wx.showModal({
      title: '结束会话',
      content: '确定结束本次咨询？',
      success: (modal) => {
        if (!modal.confirm) return;
        void (async () => {
          try {
            await endConversation(this.data.conversationId);
            this.setData({ status: 'ended' });
            if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
          } catch (cause) {
            wx.showToast({ title: cause instanceof Error ? cause.message : '操作失败', icon: 'none' });
          }
        })();
      }
    });
  },

  retry() {
    void this.bootstrap();
  }
});
