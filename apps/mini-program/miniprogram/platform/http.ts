import type { ApiResponse, MiniProductListItem, MiniProductView, PageView } from '@pindian/contracts';
import { apiConfig } from './config';

export class HttpError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
  }
}

interface RequestOptions {
  url: string;
  timeoutMs?: number;
}

/** 统一 GET 请求：解包 {data, requestId}，错误转 HttpError（code/message 来自后端）。 */
export function httpGet<T>(options: RequestOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    wx.request<ApiResponse<T>>({
      url: `${apiConfig.baseUrl}${options.url}`,
      method: 'GET',
      timeout: options.timeoutMs ?? 8000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data?.data !== undefined) {
          resolve(response.data.data);
          return;
        }
        const errorBody = response.data as Partial<ApiResponse<never>> & { code?: string; message?: string };
        reject(new HttpError(errorBody.message ?? `请求失败（HTTP ${response.statusCode}）`, errorBody.code ?? 'HTTP_ERROR', response.statusCode));
      },
      fail() {
        reject(new HttpError('网络不可用，请检查 API 地址与开发者工具网络设置', 'NETWORK_ERROR', 0));
      }
    });
  });
}

export function fetchMiniProducts(page = 1, pageSize = 10, filters: {keyword?: string; category?: string} = {}): Promise<PageView<MiniProductListItem>> {
  const query = `page=${page}&pageSize=${pageSize}&keyword=${encodeURIComponent(filters.keyword ?? '')}&category=${encodeURIComponent(filters.category ?? '')}`;
  return httpGet<PageView<MiniProductListItem>>({ url: `/api/mini/v1/products?${query}` });
}

export function fetchMiniProductDetail(id: string): Promise<MiniProductView> {
  return httpGet<MiniProductView>({ url: `/api/mini/v1/products/${id}` });
}
