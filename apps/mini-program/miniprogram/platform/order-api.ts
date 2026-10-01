import type { MiniOrderView, MiniPayParams, PayInitiation, MiniRefundView } from '@pindian/contracts';
import { storedUserToken, UserAuthExpiredError, ApiError } from './user-auth';
export { UserAuthExpiredError, ApiError };
import { apiConfig } from './config';

/** 订单接口封装（F015/F017）：金额/状态以后端为权威；幂等键客户端生成，防网络超时重试重复建单。 */

function newIdempotencyKey(): string {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-8${hex().slice(1)}-${hex()}${hex()}${hex().slice(0, 4)}`;
}

function request<T>(options: { path: string; method: 'GET' | 'POST'; body?: Record<string, unknown>; authed?: boolean }): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = storedUserToken();
    const header: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.authed) {
      if (!token) {
        reject(new UserAuthExpiredError());
        return;
      }
      header.Authorization = `Bearer ${token}`;
    }
    wx.request<ApiResponse<T>>({
      url: `${apiConfig.baseUrl}${options.path}`,
      method: options.method,
      data: options.body,
      header,
      timeout: 10000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data?.data !== undefined) {
          resolve(response.data.data);
          return;
        }
        if (response.statusCode === 401) {
          reject(new UserAuthExpiredError());
          return;
        }
        const errorBody = response.data as Partial<ApiResponse<never>> & { code?: string; message?: string };
        reject(new ApiError(errorBody.message ?? `请求失败（HTTP ${response.statusCode}）`, errorBody.code ?? 'HTTP_ERROR'));
      },
      fail() {
        reject(new ApiError('网络不可用，请稍后重试', 'NETWORK_ERROR'));
      }
    });
  });
}

interface ApiResponse<T> { data: T }

export interface PlaceOrderResult {
  id: string;
  orderNo: string;
  status: 'unpaid';
  units: number;
  quote: { totalAmountFen: number; goodsAmountFen: number; serviceFeeFen: number; tailAdjustFen: number; isFinalOrder: boolean };
  reservationExpiresAt: string;
}

export function placeOrder(productId: string, units: number, addressId: string): Promise<PlaceOrderResult> {
  return request<PlaceOrderResult>({ path: '/api/mini/v1/orders', method: 'POST', body: { productId, units, addressId, idempotencyKey: newIdempotencyKey() } });
}

export function listMyOrders(page = 1, pageSize = 10): Promise<{ items: MiniOrderView[]; page: number; pageSize: number; total: number }> {
  return request({ path: `/api/mini/v1/orders?page=${page}&pageSize=${pageSize}`, method: 'GET' });
}

export function getMyOrder(id: string): Promise<MiniOrderView> {
  return request({ path: `/api/mini/v1/orders/${id}`, method: 'GET' });
}

export function cancelMyOrder(id: string): Promise<{ cancelled: boolean }> {
  return request({ path: `/api/mini/v1/orders/${id}/cancel`, method: 'POST' });
}

// ---------- 支付（T006） ----------

export type PayParams = MiniPayParams;
export type PayInitiationView = PayInitiation;

export function payOrder(orderId: string): Promise<PayInitiation> {
  return request({ path: `/api/mini/v1/orders/${orderId}/pay`, method: 'POST', authed: true });
}

export function queryPaymentResult(orderId: string): Promise<MiniOrderView> {
  return request({ path: `/api/mini/v1/orders/${orderId}/payment-result`, method: 'POST', authed: true });
}

export type RefundView = MiniRefundView;

export function listMyRefunds(orderId: string): Promise<{ items: RefundView[] }> {
  return request({ path: `/api/mini/v1/orders/${orderId}/refunds`, method: 'GET', authed: true });
}
