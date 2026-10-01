import { getMyOrder, cancelMyOrder, payOrder, queryPaymentResult, listMyRefunds, ApiError } from '../../../../platform/order-api';
import { UserAuthExpiredError } from '../../../../platform/user-auth';
import { formatFen } from '../../../../utils/format';
import type { MiniOrderView, MiniRefundView } from '@pindian/contracts';

const STATUS_TEXT: Record<MiniOrderView['status'], string> = {
  unpaid: '待支付',
  paid: '已支付',
  cancelled: '已取消',
  expired: '已失效'
};

const REFUND_STATUS_TEXT: Record<MiniRefundView['status'], string> = {
  requested: '退款已受理',
  submitted: '退款已提交渠道',
  processing: '退款处理中',
  succeeded: '退款已到账',
  failed: '退款失败（平台将重试或人工处理）'
};

/** 模块级倒计时句柄（页面单实例）。 */
let countdownTimer: number | null = null;

Page({
  data: {
    loading: true,
    error: '',
    notFound: false,
    busy: false,
    order: null as MiniOrderView | null,
    statusText: '',
    amountText: '',
    goodsText: '',
    serviceText: '',
    tailText: '',
    canCancel: false,
    canPaidCancel: false,
    refundItems: [] as Array<{ id: string; statusText: string; amountText: string; createdAtText: string }>,
    countdownText: ''
  },

  onLoad(query: Record<string, string | undefined>) {
    void this.load(query.id ?? '');
  },

  onUnload() {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  },

  async load(id: string) {
    if (!id) {
      this.setData({ loading: false, notFound: true });
      return;
    }
    this.setData({ loading: true, error: '', notFound: false });
    try {
      const order = await getMyOrder(id);
      this.applyOrder(order);
      this.startCountdown(order);
      await this.loadRefunds(order);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '加载失败';
      this.setData({ loading: false, notFound: (cause as { status?: number }).status === 404 || message.includes('不存在'), error: message });
    }
  },

  applyOrder(order: MiniOrderView) {
    this.setData({
      order,
      statusText: STATUS_TEXT[order.status],
      amountText: formatFen(order.quote.totalAmountFen),
      goodsText: formatFen(order.quote.goodsAmountFen),
      serviceText: formatFen(order.quote.serviceFeeFen),
      tailText: order.quote.tailAdjustFen === 0 ? '' : (order.quote.tailAdjustFen > 0 ? '+' : '') + formatFen(order.quote.tailAdjustFen),
      canCancel: order.status === 'unpaid',
      canPaidCancel: order.status === 'paid',
      loading: false
    });
  },

  /** 退款进度（已支付订单可能存在全额退款；失败由平台重试，无需用户操作）。 */
  async loadRefunds(order: MiniOrderView) {
    if (order.status !== 'paid') {
      this.setData({ refundItems: [] });
      return;
    }
    try {
      const { items } = await listMyRefunds(order.id);
      this.setData({
        refundItems: items.map((refund) => ({
          id: refund.id,
          statusText: REFUND_STATUS_TEXT[refund.status],
          amountText: formatFen(refund.amountFen),
          createdAtText: refund.createdAtText
        }))
      });
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) throw cause;
      // 退款进度加载失败不阻断订单详情展示
      this.setData({ refundItems: [] });
    }
  },

  /** 预占到期倒计时（以后端 expiresAt 为准，本地只做展示计时）。 */
  startCountdown(order: MiniOrderView) {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (order.status !== 'unpaid') {
      this.setData({ countdownText: '' });
      return;
    }
    const deadline = new Date(order.reservationExpiresAt).getTime();
    const tick = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.setData({ countdownText: '份额保留已过期' });
        clearInterval(countdownTimer as number);
        countdownTimer = null;
        void this.load(order.id);
        return;
      }
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      this.setData({ countdownText: `份额保留剩余 ${minutes}:${String(seconds).padStart(2, '0')}` });
    };
    tick();
    countdownTimer = setInterval(tick, 1000) as unknown as number;
  },

  async cancelOrder() {
    if (this.data.busy || !this.data.order) return;
    const paid = this.data.order.status === 'paid';
    wx.showModal({
      title: paid ? '取消并退款' : '取消订单',
      content: paid
        ? '拼单组仍在进行中，取消将原路全额退款（含服务费），确定取消？'
        : '取消将释放该订单占用的拼单份额，确定取消？',
      success: (modal) => {
        if (modal.confirm) void this.doCancel();
      }
    });
  },

  async doCancel() {
    this.setData({ busy: true });
    try {
      await cancelMyOrder(this.data.order!.id);
      wx.showToast({ title: '已取消', icon: 'success' });
      await this.load(this.data.order!.id);
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) wx.showToast({ title: '请先登录', icon: 'none' });
      else wx.showToast({ title: cause instanceof ApiError || cause instanceof Error ? cause.message : '取消失败', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  /** 支付后刷新：触发后端查单确认，再重载订单与退款进度。 */
  async refreshPayment() {
    if (this.data.busy || !this.data.order) return;
    this.setData({ busy: true });
    const orderId = this.data.order.id;
    try {
      await queryPaymentResult(orderId);
      await this.load(orderId);
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) wx.showToast({ title: '请先登录', icon: 'none' });
      else wx.showToast({ title: cause instanceof Error ? cause.message : '刷新失败', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  /** 发起支付：调起 wx.requestPayment；前端回调仅触发后端查单确认。 */
  async initiatePay() {
    if (this.data.busy || !this.data.order) return;
    this.setData({ busy: true, error: '' });
    const orderId = this.data.order.id;
    try {
      const init = await payOrder(orderId);
      if (!init.payParams) {
        wx.showToast({ title: '支付结果确认中，请稍后刷新', icon: 'none' });
        return;
      }
      const pp = init.payParams;
      await new Promise<void>((resolve, reject) => {
        wx.requestPayment({
          timeStamp: pp.timeStamp, nonceStr: pp.nonceStr, package: pp.package,
          signType: pp.signType as 'RSA', paySign: pp.paySign,
          success: () => resolve(),
          fail: (e) => reject(new Error(e.errMsg && e.errMsg.includes('cancel') ? '已取消支付' : '支付失败')),
        });
      });
      // 前端回调不可靠——触发后端查单确认后刷新
      await queryPaymentResult(orderId).catch(() => undefined);
      await this.load(orderId);
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) { this.setData({ error: '请先登录' }); return; }
      this.setData({ error: cause instanceof Error ? cause.message : '支付失败' });
    } finally {
      this.setData({ busy: false });
    }
  },

  retry() {
    void this.load(this.data.order?.id ?? '');
  }
});
