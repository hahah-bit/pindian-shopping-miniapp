import { getCurrentConversation, openConversation, listMyTickets, listHistory } from '../../../../platform/cs-api';
import { UserAuthExpiredError } from '../../../../platform/user-auth';

const TICKET_TYPE_TEXT: Record<string, string> = {
  group_issue: '拼单问题', payment_issue: '支付问题', refund_issue: '退款问题',
  product_issue: '商品问题', shipment_issue: '发货问题', complaint: '投诉建议', other: '其他问题'
};
const TICKET_STATUS_TEXT: Record<string, string> = {
  open: '待处理', processing: '处理中', waiting_feedback:'等待反馈', resolved: '已解决', closed: '已关闭'
};

Page({
  data: {
    loading: true,
    error: '',
    conversation: null as { id: string; status: string; hasAgent: boolean } | null,
    tickets: [] as Array<{ id: string; typeText: string; statusText: string; title: string }>,
    submitting: false
    ,history: [] as Array<{id:string;statusText:string}>,historyPage:1,ticketPage:1,historyTotal:0,ticketTotal:0
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const [convResult, ticketResult,history] = await Promise.all([
        getCurrentConversation(), listMyTickets(), listHistory()
      ]);
      this.setData({
        loading: false,
        conversation: convResult.conversation,
        tickets: ticketResult.items.map((t) => ({ id: t.id, typeText: TICKET_TYPE_TEXT[t.type] ?? t.type, statusText: TICKET_STATUS_TEXT[t.status] ?? t.status, title: t.title })),ticketPage:1,ticketTotal:ticketResult.total,
        history:history.items.map(c=>({id:c.id,statusText:c.status==='ended'?'已结束':c.status==='converted'?'已转工单':c.status==='queued'?'排队留言':'接待中'})),historyPage:1,historyTotal:history.total
      });
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) { this.setData({loading:false});wx.switchTab({ url: '/features/profile/pages/index/index' }); return; }
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
  },
  openAi(){wx.switchTab({url:'/features/ai-support/pages/chat/index'});},
  create(){wx.navigateTo({url:'/features/cs/pages/ticket-form/index'});},
  openTicket(e:WechatMiniprogram.TouchEvent){wx.navigateTo({url:`/features/cs/pages/ticket-detail/index?id=${e.currentTarget.dataset.id}`});},
  async moreTickets(){try{const r=await listMyTickets(this.data.ticketPage+1);this.setData({ticketPage:this.data.ticketPage+1,tickets:[...this.data.tickets,...r.items.map(t=>({id:t.id,title:t.title,typeText:TICKET_TYPE_TEXT[t.type]??t.type,statusText:TICKET_STATUS_TEXT[t.status]??t.status}))]});}catch(e){wx.showToast({title:e instanceof Error?e.message:'读取失败',icon:'none'});}},
  async moreHistory(){try{const r=await listHistory(this.data.historyPage+1);this.setData({historyPage:this.data.historyPage+1,history:[...this.data.history,...r.items.map(c=>({id:c.id,statusText:c.status==='ended'?'已结束':c.status==='converted'?'已转工单':c.status==='queued'?'排队留言':'接待中'}))]});}catch(e){wx.showToast({title:e instanceof Error?e.message:'读取失败',icon:'none'});}}
});
