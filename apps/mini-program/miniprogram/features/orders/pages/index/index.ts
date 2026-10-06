import { listMyOrders, cancelMyOrder, UserAuthExpiredError } from '../../../../platform/order-api';
import { storedUserToken } from '../../../../platform/user-auth';
import { formatFen } from '../../../../utils/format';
import type { MiniOrderView } from '@pindian/contracts';

interface OrderItem {
  id: string;
  orderNo: string;
  status: MiniOrderView['status'];
  statusText: string;
  unitsLabel: string;
  amountText: string;
  createdAtText: string;
  canCancel: boolean;
}

const STATUS_TEXT: Record<MiniOrderView['status'], string> = {
  unpaid: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  expired: '已失效'
};

Page({
  data: {
    needLogin: false,
    loading: true,
    error: '',
    items: [] as OrderItem[],
    page: 1,
    total: 0,
    hasMore: false,
    busyId: '',
    paymentNotice: '微信支付暂未开放，开放后可在订单详情中支付'
  },

  onShow() {
    if (!storedUserToken()) {
      this.setData({ needLogin: true, loading: false, items: [] });
      return;
    }
    void this.reload();
  },

  onPullDownRefresh() {
    void this.reload().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) void this.loadMore();
  },

  async reload() {
    if (!storedUserToken()) {
      this.setData({ needLogin: true, loading: false, items: [] });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await listMyOrders(1, 10);
      this.setData({ items: result.items.map((o) => this.decorate(o)), page: 1, total: result.total, hasMore: result.items.length < result.total });
    } catch (cause) {
      this.handleError(cause);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMore() {
    this.setData({ loading: true });
    try {
      const next = this.data.page + 1;
      const result = await listMyOrders(next, 10);
      this.setData({ items: [...this.data.items, ...result.items.map((o) => this.decorate(o))], page: next, hasMore: this.data.items.length + result.items.length < result.total });
    } catch (cause) {
      wx.showToast({ title: cause instanceof Error ? cause.message : '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  decorate(order: MiniOrderView): OrderItem {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      statusText: STATUS_TEXT[order.status],
      unitsLabel: ({30:'1/2 份',20:'1/3 份',15:'1/4 份',12:'1/5 份'} as Record<number,string>)[order.units]??order.units+'/60 份',
      amountText: formatFen(order.quote.totalAmountFen),
      createdAtText: new Date(order.createdAt).toLocaleString(),
      canCancel: order.status === 'unpaid'
    };
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const id = (event.currentTarget.dataset as { id?: string }).id;
    if (id) wx.navigateTo({ url: '/features/orders/pages/detail/index?id=' + id });
  },

  onCancel(event: WechatMiniprogram.TouchEvent) {
    const id = (event.currentTarget.dataset as { id?: string }).id;
    if (!id || this.data.busyId) return;
    wx.showModal({
      title: '取消订单',
      content: '取消将释放该订单占用的拼单份额，确定取消？',
      success: (modal) => { if (modal.confirm) void this.doCancel(id); }
    });
  },

  async doCancel(id: string) {
    this.setData({ busyId: id });
    try {
      await cancelMyOrder(id);
      await this.reload();
      wx.showToast({ title: '已取消', icon: 'success' });
    } catch (cause) {
      this.handleError(cause);
    } finally {
      this.setData({ busyId: '' });
    }
  },

  handleError(cause: unknown) {
    if (cause instanceof UserAuthExpiredError) this.setData({ needLogin: true, items: [] });
    else this.setData({ error: cause instanceof Error ? cause.message : '加载失败' });
  },

  goLogin() {
    wx.switchTab({ url: '/features/profile/pages/index/index' });
  },

  goHome() {
    wx.switchTab({ url: '/features/catalog/pages/index/index' });
  },

  retry() {
    void this.reload();
  }
});
