import { getProductDetail, toCatalogError } from '../../../../platform/api-catalog';
import { placeOrder, ApiError as OrderApiError } from '../../../../platform/order-api';
import { listAddresses, storedUserToken } from '../../../../platform/user-auth';
import type { AddressView } from '@pindian/contracts';
import { apiConfig } from '../../../../platform/config';
import { formatFen } from '../../../../utils/format';
import type { MiniProductView } from '@pindian/contracts';

type ShareOptionItem = MiniProductView['shareOptions'][number] & { priceText: string };

type DetailData = Omit<MiniProductView, 'shareOptions'> & {
  source: string;
  isMock: boolean;
  loading: boolean;
  error: string;
  notFound: boolean;
  soldOut: boolean;
  wholePriceText: string;
  fromPriceText: string;
  quantitySummary: string;
  gallery: { url: string; failed: boolean }[];
  galleryIndex: number;
  visible: boolean;
  shareOptions: ShareOptionItem[];
  order: import('@pindian/contracts').MiniOrderView | null;
  orderPanelOpen: boolean;
  selectedUnits: number | null;
  selectedAddress: { id: string; label: string } | null;
  placingOrder: boolean;
  orderError: string;
};

Page<DetailData, WechatMiniprogram.IAnyObject>({
  data: {
    source: apiConfig.mode === 'mock' ? 'Mock 数据预览' : '真实后端数据',
    isMock: apiConfig.mode === 'mock',
    loading: true,
    error: '',
    notFound: false,
    id: '',
    name: '',
    description: '',
    mainImageUrl: '',
    detailImageUrls: [],
    originalPriceFen: 0,
    userWholePriceFen: 0,
    priceFromFen: 0,
    wholeQuantity: '',
    unit: '',
    stockStatus: 'available',
    soldOut: false,
    wholePriceText: '',
    fromPriceText: '',
    quantitySummary: '',
    gallery: [],
    galleryIndex: 0,
    visible: true,
    shareOptions: [],
    order: null,
    orderPanelOpen: false,
    selectedUnits: null,
    selectedAddress: null as { id: string; label: string } | null,
    placingOrder: false,
    orderError: ''
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: query.id ?? '' });
    void this.load();
  },

  onShow() {
    this.setData({ visible: true });
    if (this.data.orderPanelOpen) void this.refreshAddress();
  },
  onHide() { this.setData({ visible: false }); },
  onUnload() { this.setData({ visible: false }); },
  onGalleryChange(event: WechatMiniprogram.CustomEvent<{current: number}>) { this.setData({galleryIndex: event.detail.current}); },
  preventBubble() {},

  async load() {
    const id = this.data.id;
    if (!id) {
      this.setData({ loading: false, notFound: true, error: '缺少商品参数' });
      return;
    }
    this.setData({ loading: true, error: '', notFound: false });
    try {
      const detail = await getProductDetail(id);
      const gallery = [detail.mainImageUrl, ...detail.detailImageUrls]
        .filter((url): url is string => Boolean(url))
        .map((url) => ({ url, failed: false }));
      const deduped = gallery.filter((item, index) => gallery.findIndex((g) => g.url === item.url) === index);
      this.setData({
        ...detail,
        soldOut: detail.stockStatus === 'sold_out',
        wholePriceText: formatFen(detail.userWholePriceFen),
        fromPriceText: formatFen(detail.priceFromFen),
        quantitySummary: `${detail.wholeQuantity} ${detail.unit}/件`,
        gallery: deduped,
        shareOptions: detail.shareOptions.map((option) => ({ ...option, priceText: formatFen(option.referencePriceFen) })),
        loading: false
      });
      wx.setNavigationBarTitle({ title: detail.name });
    } catch (cause) {
      const error = toCatalogError(cause);
      this.setData({ loading: false, notFound: error.kind === 'not-found', error: error.message });
    }
  },

  onImageError(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
    const index = Number((event.target?.dataset as { index?: number }).index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.gallery.length) return;
    this.setData({ [`gallery[${index}].failed`]: true });
  },

  previewImage(event: WechatMiniprogram.TouchEvent) {
    const index = Number((event.currentTarget.dataset as { index?: number }).index);
    const urls = this.data.gallery.map((item) => item.url);
    if (!urls.length) return;
    wx.previewImage({ urls, current: Number.isInteger(index) ? urls[index] : undefined });
  },

  retry() {
    void this.load();
  },

  /** 点击份额卡片选中/取消；未登录先提示。 */
  toggleSelectShare(event: WechatMiniprogram.TouchEvent) {
    const units = Number((event.currentTarget.dataset as { units?: number }).units);
    if (!storedUserToken()) {
      wx.showToast({ title: '请先登录后再下单', icon: 'none' });
      return;
    }
    if (this.data.soldOut) {
      wx.showToast({ title: '商品已售罄', icon: 'none' });
      return;
    }
    this.setData({ selectedUnits: this.data.selectedUnits === units ? null : units, orderError: '' });
  },

  async openOrderPanel() {
    if (this.data.selectedUnits === null) {
      wx.showToast({ title: '请先选择份额', icon: 'none' });
      return;
    }
    this.setData({ orderPanelOpen: true, orderError: '' });
    await this.refreshAddress();
  },

  async refreshAddress() {
    try {
      const result = await listAddresses();
      const preferred = result.items.find((a) => a.isDefault) ?? result.items[0] ?? null;
      this.setData({
        selectedAddress: preferred ? { id: preferred.id, label: `${preferred.receiverName} ${preferred.phone}（${preferred.province}${preferred.city}${preferred.district} ${preferred.detail}）` } : null
      });
    } catch (cause) {
      this.setData({ selectedAddress: null, orderError: cause instanceof Error ? cause.message : '地址加载失败，请重试' });
    }
  },

  closeOrderPanel() {
    this.setData({ orderPanelOpen: false, orderError: '' });
  },

  goToAddresses() {
    wx.navigateTo({ url: '/features/address/pages/list/index' });
  },

  /** 提交订单：金额由服务端计算；客户端只传商品/份额/地址与幂等键。 */
  async submitOrder() {
    if (this.data.placingOrder) return;
    const units = this.data.selectedUnits;
    if (!units || !this.data.id) return;
    if (!this.data.selectedAddress) {
      this.setData({ orderError: '请先添加收货地址' });
      return;
    }
    this.setData({ placingOrder: true, orderError: '' });
    try {
      const result = await placeOrder(this.data.id, units, this.data.selectedAddress.id);
      this.setData({ orderPanelOpen: false });
      wx.navigateTo({ url: `/features/orders/pages/detail/index?id=${result.id}` });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '下单失败';
      this.setData({ orderError: message });
      if (cause instanceof OrderApiError && cause.code === 'UNAUTHENTICATED') wx.showToast({ title: '请先登录', icon: 'none' });
    } finally {
      this.setData({ placingOrder: false });
    }
  }
});
