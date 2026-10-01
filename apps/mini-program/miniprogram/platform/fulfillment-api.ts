import type { MiniFulfillmentView, MiniFulfillmentResult } from '@pindian/contracts';
import { storedUserToken, UserAuthExpiredError, ApiError } from './user-auth';
export { UserAuthExpiredError, ApiError };
import { apiConfig } from './config';

/** 履约接口封装（T007 F030）：履约进度/包裹/运单/确认收货，以后端为权威。 */

export type { MiniFulfillmentView, MiniFulfillmentResult };

interface ApiResponse<T> { data: T }

function request<T>(options: { path: string; method: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = storedUserToken();
    if (!token) {
      reject(new UserAuthExpiredError());
      return;
    }
    wx.request<ApiResponse<T>>({
      url: `${apiConfig.baseUrl}${options.path}`,
      method: options.method,
      data: options.body,
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

/** 本人订单的履约进度；fulfillmentOrder=null 表示尚未生成（组未成功或生成中）。 */
export function getOrderFulfillment(orderId: string): Promise<MiniFulfillmentResult> {
  return request<MiniFulfillmentResult>({ path: `/api/mini/v1/orders/${orderId}/fulfillment`, method: 'GET' });
}

/** 确认收货（仅 shipped；幂等）。 */
export function confirmReceipt(fulfillmentOrderId: string): Promise<{ status: string; completedBy: string | null }> {
  return request({ path: `/api/mini/v1/fulfillment-orders/${fulfillmentOrderId}/confirm-receipt`, method: 'POST' });
}
