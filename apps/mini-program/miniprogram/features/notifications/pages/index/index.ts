import { fetchMyNotifications, markNotificationRead, UserAuthExpiredError, type NotificationView } from '../../../../platform/notification-api';
import { apiConfig } from '../../../../platform/config';

function formatTime(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return shifted.toISOString().replace('T', ' ').slice(5, 16);
}

const PAGE_SIZE = 20;

Page({
  data: {
    isMock: apiConfig.mode === 'mock',
    loading: false,
    loadingMore: false,
    error: '',
    items: [] as Array<NotificationView & { createdAtText: string }>,
    page: 1,
    total: 0,
    unreadCount: 0,
    needLogin: false
  },

  onShow() {
    void this.reload();
  },

  onPullDownRefresh() {
    void this.reload().then(() => wx.stopPullDownRefresh());
  },

  async reload() {
    this.setData({ loading: true, error: '', needLogin: false });
    try {
      const result = await fetchMyNotifications(1, PAGE_SIZE);
      this.setData({
        items: result.items.map((n) => ({ ...n, createdAtText: formatTime(n.createdAt) })),
        page: 1,
        total: result.total,
        unreadCount: result.unreadCount
      });
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) {
        this.setData({ needLogin: true, error: '请先登录后查看消息' });
        return;
      }
      this.setData({ error: cause instanceof Error ? cause.message : '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMore() {
    if (this.data.loadingMore) return;
    const nextPage = this.data.page + 1;
    this.setData({ loadingMore: true });
    try {
      const result = await fetchMyNotifications(nextPage, PAGE_SIZE);
      this.setData({
        items: [...this.data.items, ...result.items.map((n) => ({ ...n, createdAtText: formatTime(n.createdAt) }))],
        page: nextPage,
        total: result.total
      });
    } catch (cause) {
      this.setData({ error: cause instanceof Error ? cause.message : '加载失败' });
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  async onTapNotice(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const notice = this.data.items[index];
    if (!notice) return;
    if (notice.readAt) return;
    try {
      const result = await markNotificationRead(notice.id);
      const items = [...this.data.items];
      items[index] = { ...notice, readAt: result.notification.readAt };
      this.setData({
        items,
        unreadCount: Math.max(0, this.data.unreadCount - 1)
      });
    } catch (cause) {
      if (!(cause instanceof UserAuthExpiredError)) {
        this.setData({ error: cause instanceof Error ? cause.message : '标记已读失败' });
      }
    }
  },

  retry() {
    void this.reload();
  }
});
