import { storedUserToken, storeUserToken, UserAuthExpiredError, ApiError } from './user-auth';
import { apiConfig } from './config';

/** 消息中心接口封装（T009/F040，D023）：仅本人通知、已读幂等。 */

interface ApiEnvelope<T> { data: T }

export { UserAuthExpiredError, ApiError };

export interface NotificationView {
  id: string;
  eventType: string;
  title: string;
  body: string;
  reference: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  unreadCount: number;
}

export function notificationRequest<T>(options: { path: string; method: 'GET' | 'POST' }): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = storedUserToken();
    if (!token) {
      reject(new UserAuthExpiredError());
      return;
    }
    wx.request<ApiEnvelope<T>>({
      url: `${apiConfig.baseUrl}${options.path}`,
      method: options.method,
      header: { Authorization: `Bearer ${token}` },
      timeout: 10000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data?.data !== undefined) {
          resolve(response.data.data);
          return;
        }
        if (response.statusCode === 401) {
          storeUserToken(null);
          reject(new UserAuthExpiredError());
          return;
        }
        const errorBody = response.data as Partial<ApiEnvelope<never>> & { code?: string; message?: string };
        reject(new ApiError(errorBody.message ?? `请求失败（HTTP ${response.statusCode}）`, errorBody.code ?? 'HTTP_ERROR'));
      },
      fail() {
        reject(new ApiError('网络不可用，请稍后重试', 'NETWORK_ERROR'));
      }
    });
  });
}

export function fetchMyNotifications(page = 1, pageSize = 20): Promise<NotificationListResult> {
  return notificationRequest<NotificationListResult>({ path: `/api/mini/v1/notifications?page=${page}&pageSize=${pageSize}`, method: 'GET' });
}

export function markNotificationRead(id: string): Promise<{ notification: NotificationView }> {
  return notificationRequest<{ notification: NotificationView }>({ path: `/api/mini/v1/notifications/${id}/read`, method: 'POST' });
}

/** 消息中心未读数（未登录返回 0，供「我的」页角标）。 */
export async function fetchUnreadCount(): Promise<number> {
  try {
    const result = await fetchMyNotifications(1, 1);
    return result.unreadCount;
  } catch {
    return 0;
  }
}
