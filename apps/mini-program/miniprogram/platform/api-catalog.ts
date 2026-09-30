import type { MiniProductListItem, MiniProductView, PageView, ShareUnits } from '@pindian/contracts';
import { apiConfig } from './config';
import { fetchMiniProductDetail, fetchMiniProducts, HttpError } from './http';

/**
 * 数据来源：config.ts 的 mode。api 为默认；mock 与真实契约同构，仅用于
 * 无后端时的界面预览，页面会标注来源，不冒充真实数据。
 */

const MOCK_LIST: PageView<MiniProductListItem> = {
  items: [
    { id: 'mock-1', name: '【Mock】红富士苹果', mainImageUrl: '', originalPriceFen: 50000, userWholePriceFen: 50500, priceFromFen: 10100, stockStatus: 'available' },
    { id: 'mock-2', name: '【Mock】赣南脐橙', mainImageUrl: '', originalPriceFen: 3980, userWholePriceFen: 4480, priceFromFen: 901, stockStatus: 'sold_out' }
  ],
  page: 1, pageSize: 10, total: 2
};

const MOCK_DETAIL: MiniProductView = {
  id: 'mock-1',
  name: '【Mock】红富士苹果',
  description: '产地直发，10 斤装。此为 Mock 数据，仅用于界面预览。',
  mainImageUrl: '',
  detailImageUrls: [],
  originalPriceFen: 50000,
  userWholePriceFen: 50500,
  priceFromFen: 10100,
  wholeQuantity: '10',
  unit: '斤',
  shareOptions: [
    { units: 30 as ShareUnits, fractionLabel: '1/2', quantityText: '5', referencePriceFen: 25250 },
    { units: 20 as ShareUnits, fractionLabel: '1/3', quantityText: '3.333', referencePriceFen: 16833 },
    { units: 15 as ShareUnits, fractionLabel: '1/4', quantityText: '2.5', referencePriceFen: 12625 },
    { units: 12 as ShareUnits, fractionLabel: '1/5', quantityText: '2', referencePriceFen: 10100 }
  ],
  stockStatus: 'available'
};

export type CatalogError = {
  message: string;
  kind: 'network' | 'not-found' | 'server';
};

export function toCatalogError(cause: unknown): CatalogError {
  if (cause instanceof HttpError) {
    return {
      message: cause.message,
      kind: cause.status === 404 ? 'not-found' : cause.status === 0 ? 'network' : 'server'
    };
  }
  return { message: '加载失败，请稍后重试', kind: 'server' };
}

export async function getProducts(page = 1, pageSize = 10): Promise<PageView<MiniProductListItem>> {
  if (apiConfig.mode === 'mock') return MOCK_LIST;
  return fetchMiniProducts(page, pageSize);
}

export async function getProductDetail(id: string): Promise<MiniProductView> {
  if (apiConfig.mode === 'mock') {
    const found = MOCK_LIST.items.find((item) => item.id === id);
    if (!found) throw new HttpError('商品不存在', 'NOT_FOUND', 404);
    return { ...MOCK_DETAIL, id: found.id, name: found.name, stockStatus: found.stockStatus };
  }
  return fetchMiniProductDetail(id);
}
