import { getCurrentConversation, openConversation, listMyTickets } from '../../../../platform/cs-api';
import { UserAuthExpiredError } from '../../../../platform/user-auth';

const TICKET_TYPE_TEXT: Record<string, string> = {
  group_issue: '拼单问题', payment_issue: '支付问题', refund_issue: '退款问题',
  product_issue: '商品问题', shipment_issue: '发货问题', complaint: '投诉建议', other: '其他问题'
};
const TICKET_STATUS_TEXT: Record<string, string> = {
  open: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭'
};

Page({
  data: {
    loading: true,
    error: '',
    conversation: null as { id: string; status: string; hasAgent: boolean } | null,
    tickets: [] as Array<{ id: string; typeText: string; statusText: string; title: string }>,
    submitting: false
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [convResult, ticketResult] = await Promise.all([
        getCurrentConversation().catch(() => ({ conversation: null })),
        listMyTickets().catch(() => ({ items: [], total: 0 }))
      ]);
      this.setData({
        loading: false,
        conversation: convResult.conversation,
        tickets: ticketResult.items.map((t) => ({ id: t.id, typeText: TICKET_TYPE_TEXT[t.type] ?? t.type, statusText: TICKET_STATUS_TEXT[t.status] ?? t.status, title: t.title }))
      });
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) { wx.navigateTo({ url: '/features/profile/pages/index/index' }); return; }
      this.setData({ loading: false, error: cause instanceof Error ? cause.message : '加载失败' });
    }
  },

  async startChat() {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const result = await openConversation();
      wx.navigateTo({ url: `/features/cs/pages/chat/chat?id=${result.conversation.id}` });
    } catch (cause) {
      wx.showToast({ title: cause instanceof Error ? cause.message : '发起失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  openChat(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    if (id) wx.navigateTo({ url: `/features/cs/pages/chat/chat?id=${id}` });
  },

  retry() {
    void this.load();
  }
});
