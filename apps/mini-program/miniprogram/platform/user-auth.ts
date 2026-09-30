import type { MiniUserView, MiniLoginResponse, AddressView } from '@pindian/contracts';
import { apiConfig } from './config';

/**
 * 用户会话封装（F009/F010/F011）：
 * - token 存 storage；401 自动清除并抛 UserAuthExpiredError 供页面回到未登录态；
 * - 登录调用后端 code2Session，身份以后端为准；未配置凭据时接口返回明确的
 *   WECHAT_NOT_CONFIGURED，本模块不伪造登录成功。
 */

const TOKEN_KEY = 'pindian_user_token';

export class UserAuthExpiredError extends Error {
  constructor() {
    super('登录已过期，请重新登录');
    this.name = 'UserAuthExpiredError';
  }
}

export class ApiError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export function storedUserToken(): string | null {
  return wx.getStorageSync(TOKEN_KEY) || null;
}

export function storeUserToken(token: string | null): void {
  if (token) wx.setStorageSync(TOKEN_KEY, token);
  else wx.removeStorageSync(TOKEN_KEY);
}

function request<T>(options: { path: string; method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: Record<string, unknown>; authed: boolean; timeoutMs?: number }): Promise<T> {
  return new Promise((resolve, reject) => {
    const header: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = storedUserToken();
    if (options.authed) {
      if (!token) {
        reject(new UserAuthExpiredError());
        return;
      }
      header.Authorization = `Bearer ${token}`;
    }
    wx.request<ApiResponse<T>>({
      url: `${apiConfig.baseUrl}${options.path}`,
      // 小程序官方 method 枚举未列 PATCH，但原生网络层支持；此处断言绕过类型限制
      method: options.method as 'GET',
      data: options.body,
      header,
      timeout: options.timeoutMs ?? 8000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data?.data !== undefined) {
          resolve(response.data.data);
          return;
        }
        if (response.statusCode === 401 && options.authed) {
          storeUserToken(null);
          reject(new UserAuthExpiredError());
          return;
        }
        const errorBody = response.data as Partial<ApiResponse<never>> & { code?: string; message?: string };
        reject(new ApiError(errorBody.message ?? `请求失败（HTTP ${response.statusCode}）`, errorBody.code ?? 'HTTP_ERROR'));
      },
      fail() {
        reject(new ApiError('网络不可用，请检查 API 地址与开发者工具网络设置', 'NETWORK_ERROR'));
      }
    });
  });
}

interface ApiResponse<T> { data: T }

export async function wechatLogin(code: string): Promise<MiniLoginResponse> {
  const result = await request<MiniLoginResponse>({ path: '/api/mini/v1/auth/login', method: 'POST', body: { code }, authed: false });
  storeUserToken(result.token);
  return result;
}

/** 登录态可用时返回用户视图；无 token 返回 null（不主动触发 wx.login，避免页面加载即弹登录）。 */
export async function fetchCurrentUser(): Promise<MiniUserView | null> {
  if (!storedUserToken()) return null;
  try {
    return await request<MiniUserView>({ path: '/api/mini/v1/auth/me', method: 'GET', authed: true });
  } catch (error) {
    if (error instanceof UserAuthExpiredError) return null;
    throw error;
  }
}

export async function logoutCurrentUser(): Promise<void> {
  try {
    await request<{ revoked: boolean }>({ path: '/api/mini/v1/auth/logout', method: 'POST', authed: true });
  } finally {
    storeUserToken(null);
  }
}

export function updateNickname(nickname: string): Promise<MiniUserView> {
  return request<MiniUserView>({ path: '/api/mini/v1/auth/profile', method: 'PATCH', body: { nickname }, authed: true });
}

export function bindPhoneNumber(code: string): Promise<{ hasPhone: true; phoneMasked: string; phoneVerified: true }> {
  return request({ path: '/api/mini/v1/auth/phone', method: 'POST', body: { code }, authed: true });
}

// ---------- 地址 ----------

export function listAddresses(): Promise<{ items: AddressView[] }> {
  return request({ path: '/api/mini/v1/addresses', method: 'GET', authed: true });
}

export function createAddress(input: Omit<AddressView, 'id' | 'isDefault' | 'createdAt' | 'updatedAt'>): Promise<AddressView> {
  return request({ path: '/api/mini/v1/addresses', method: 'POST', body: input, authed: true });
}

export function updateAddress(id: string, input: Omit<AddressView, 'id' | 'isDefault' | 'createdAt' | 'updatedAt'>): Promise<AddressView> {
  return request({ path: `/api/mini/v1/addresses/${id}`, method: 'PATCH', body: input, authed: true });
}

export function deleteAddress(id: string): Promise<{ deleted: boolean }> {
  return request({ path: `/api/mini/v1/addresses/${id}`, method: 'DELETE', authed: true });
}

export function setDefaultAddress(id: string): Promise<{ items: AddressView[] }> {
  return request({ path: `/api/mini/v1/addresses/${id}/default`, method: 'PUT', authed: true });
}

/** 触发微信登录（wx.login → code → 后端建会话）。 */
export function loginWithWechat(): Promise<MiniLoginResponse> {
  return new Promise((resolve, reject) => {
    wx.login({
      success(loginResult) {
        if (!loginResult.code) {
          reject(new ApiError('未获取到微信登录凭证，请重试', 'WX_NO_CODE'));
          return;
        }
        wechatLogin(loginResult.code).then(resolve).catch(reject);
      },
      fail() {
        reject(new ApiError('微信登录调用失败，请重试', 'WX_LOGIN_FAIL'));
      }
    });
  });
}
