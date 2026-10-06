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
let searchTimer: ReturnType<typeof setTimeout> | undefined;

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
    hasMore: false, keyword: '', category: '', requestVersion: 0,
    categories: [{id:'',label:'全部'},{id:'fruit',label:'水果鲜食'},{id:'snack',label:'休闲零食'},{id:'drink',label:'饮品咖啡'},{id:'other',label:'其他好物'}]
  },

  onLoad() {
    void this.reload();
  },

  onUnload() { if(searchTimer !== undefined)clearTimeout(searchTimer); this.setData({requestVersion:this.data.requestVersion+1}); },
  onSearchInput(event: WechatMiniprogram.Input) {
    if(searchTimer !== undefined)clearTimeout(searchTimer);this.setData({keyword:event.detail.value,requestVersion:this.data.requestVersion+1});
    searchTimer=setTimeout(()=>void this.reload(),300);
  },
  search() { if(searchTimer !== undefined)clearTimeout(searchTimer); void this.reload(); },
  clearSearch() { if(searchTimer !== undefined)clearTimeout(searchTimer); this.setData({keyword:''}); void this.reload(); },
  selectCategory(event: WechatMiniprogram.TouchEvent) {
    if(searchTimer !== undefined)clearTimeout(searchTimer);const category=(event.currentTarget.dataset as {id?:string}).id ?? '';
    if(category===this.data.category)return;this.setData({category});void this.reload();
  },
  onPullDownRefresh() {
    void this.reload().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore && !this.data.loading) void this.loadMore();
  },

  async reload() {
    const version=this.data.requestVersion+1;
    this.setData({ loading: true, loadingMore:false, error: '', page: 1,requestVersion:version });
    try {
      const result = await getProducts(1, PAGE_SIZE,{keyword:this.data.keyword,category:this.data.category});
      if(version!==this.data.requestVersion)return;
      this.setData({
        items: result.items.map((item) => this.decorate(item)),
        total: result.total,
        page: 1,
        hasMore: result.items.length < result.total
      });
    } catch (cause) {
      if(version!==this.data.requestVersion)return;
      this.setData({ error: toCatalogError(cause).message, items: [], total: 0, hasMore: false });
    } finally {
      if(version===this.data.requestVersion)this.setData({ loading: false });
    }
  },

  async loadMore() {
    const version=this.data.requestVersion;
    this.setData({ loadingMore: true });
    try {
      const nextPage = this.data.page + 1;
      const result = await getProducts(nextPage, PAGE_SIZE,{keyword:this.data.keyword,category:this.data.category});
      if(version!==this.data.requestVersion)return;
      this.setData({
        items: [...this.data.items, ...result.items.map((item) => this.decorate(item))],
        page: nextPage,
        hasMore: this.data.items.length + result.items.length < result.total
      });
    } catch (cause) {
      if(version!==this.data.requestVersion)return;
      wx.showToast({ title: toCatalogError(cause).message, icon: 'none' });
    } finally {
      if(version===this.data.requestVersion)this.setData({ loadingMore: false });
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
