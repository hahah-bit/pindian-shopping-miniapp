import { getProductDetail, toCatalogError } from '../../../../platform/api-catalog';
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
  shareOptions: ShareOptionItem[];
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
    shareOptions: []
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ id: query.id ?? '' });
    void this.load();
  },

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
  }
});
