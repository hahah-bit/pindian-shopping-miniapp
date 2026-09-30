import { apiConfig } from '../../../../platform/config';
import { getProducts, toCatalogError } from '../../../../platform/api-catalog';
import { formatFen } from '../../../../utils/format';
import type { MiniProductListItem } from '@pindian/contracts';

interface ListItem extends MiniProductListItem {
  wholePriceText: string;
  fromPriceText: string;
  soldOut: boolean;
  imageFailed: boolean;
}

const PAGE_SIZE = 10;

Page({
  data: {
    source: apiConfig.mode === 'mock' ? 'Mock 数据预览' : '真实后端数据',
    isMock: apiConfig.mode === 'mock',
    loading: false,
    loadingMore: false,
    error: '',
    items: [] as ListItem[],
    page: 1,
    total: 0,
    hasMore: false
  },

  onLoad() {
    void this.reload();
  },

  onPullDownRefresh() {
    void this.reload().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) void this.loadMore();
  },

  async reload() {
    this.setData({ loading: true, error: '', page: 1 });
    try {
      const result = await getProducts(1, PAGE_SIZE);
      this.setData({
        items: result.items.map((item) => this.decorate(item)),
        total: result.total,
        page: 1,
        hasMore: result.items.length < result.total
      });
    } catch (cause) {
      this.setData({ error: toCatalogError(cause).message, items: [], total: 0, hasMore: false });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadMore() {
    this.setData({ loadingMore: true });
    try {
      const nextPage = this.data.page + 1;
      const result = await getProducts(nextPage, PAGE_SIZE);
      this.setData({
        items: [...this.data.items, ...result.items.map((item) => this.decorate(item))],
        page: nextPage,
        hasMore: this.data.items.length + result.items.length < result.total
      });
    } catch (cause) {
      wx.showToast({ title: toCatalogError(cause).message, icon: 'none' });
    } finally {
      this.setData({ loadingMore: false });
    }
  },

  decorate(item: MiniProductListItem): ListItem {
    return {
      ...item,
      wholePriceText: formatFen(item.userWholePriceFen),
      fromPriceText: formatFen(item.priceFromFen),
      soldOut: item.stockStatus === 'sold_out',
      imageFailed: false
    };
  },

  onImageError(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
    const index = Number((event.target?.dataset as { index?: number }).index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.items.length) return;
    this.setData({ [`items[${index}].imageFailed`]: true });
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const id = (event.currentTarget.dataset as { id?: string }).id;
    if (!id) return;
    wx.navigateTo({ url: `/features/catalog/pages/detail/index?id=${id}` });
  },

  retry() {
    void this.reload();
  }
});
