import type { AdminGroupListItem, AdminOrderListItem, AdminPhoneReveal, AdminUserListItem, AdminProductListItem, AdminProductView, ApiResponse, CreateProductRequest, LoginResponse, MediaAssetAdminView, MediaAssetView, MiniProductListItem, MiniProductView, PageView, PlatformInfo, StockAdjustmentRequest, StockAdjustmentResult, StockMovementView, StockView, UpdateProductRequest, AdminPaymentListItem, AdminRefundListItem, PaymentAnomaliesView, AdminFulfillmentGroupSummary, AdminFulfillmentDetail } from '@pindian/contracts';

/** 结构化 API 错误：携带后端错误码与原因清单。 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: string[];

  constructor(message: string, code: string, status: number, details?: string[]) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const TOKEN_KEY = 'pindian_admin_token';

export function storedToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) {
    const payload = (await response.json()) as ApiResponse<T>;
    return payload.data;
  }
  let code = 'HTTP_ERROR';
  let message = `请求失败（HTTP ${response.status}）`;
  let details: string[] | undefined;
  try {
    const body = (await response.json()) as { code?: string; message?: string; details?: string[] };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
    if (body.details) details = body.details;
  } catch { /* 非 JSON 错误体 */ }
  throw new ApiClientError(message, code, response.status, details);
}

async function request<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body) headers.set('Content-Type', 'application/json');
  const activeToken = token === undefined ? storedToken() : token;
  if (activeToken) headers.set('Authorization', `Bearer ${activeToken}`);
  const response = await fetch(path, { ...init, headers, signal: AbortSignal.timeout(20_000) });
  return unwrap<T>(response);
}

// ---------- 框架 ----------

export async function getPlatform(fetcher: typeof fetch = fetch): Promise<PlatformInfo> {
  const response = await fetcher('/api/admin/v1/platform', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`框架接口暂不可用（HTTP ${response.status}）`);
  const payload: ApiResponse<PlatformInfo> = await response.json();
  if (payload.data?.stage !== 'foundation' || !Array.isArray(payload.data.contexts) || payload.data.businessReady !== false) {
    throw new Error('框架接口返回的数据不符合当前契约');
  }
  return payload.data;
}

// ---------- 身份 ----------

export async function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/api/admin/v1/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }, null);
}

export async function logout(): Promise<void> {
  await request('/api/admin/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
}

export async function fetchMe(): Promise<LoginResponse['admin']> {
  return request<LoginResponse['admin']>('/api/admin/v1/auth/me');
}

// ---------- 图片 ----------

export async function listMediaAssets(page = 1, pageSize = 12): Promise<PageView<MediaAssetAdminView>> {
  return request<PageView<MediaAssetAdminView>>(`/api/admin/v1/media?page=${page}&pageSize=${pageSize}`);
}

export async function uploadMediaAsset(file: File): Promise<MediaAssetView> {
  const form = new FormData();
  form.append('file', file);
  return request<MediaAssetView>('/api/admin/v1/media', { method: 'POST', body: form });
}

export async function deleteMediaAsset(id: string): Promise<void> {
  await request(`/api/admin/v1/media/${id}`, { method: 'DELETE' });
}

// ---------- 商品 ----------

export async function listAdminProducts(query: { status?: string; keyword?: string; page?: number; pageSize?: number } = {}): Promise<PageView<AdminProductListItem>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.keyword) params.set('keyword', query.keyword);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 10));
  return request<PageView<AdminProductListItem>>(`/api/admin/v1/products?${params.toString()}`);
}

export async function getAdminProduct(id: string): Promise<AdminProductView> {
  return request<AdminProductView>(`/api/admin/v1/products/${id}`);
}

export async function createProduct(body: CreateProductRequest): Promise<AdminProductView> {
  return request<AdminProductView>('/api/admin/v1/products', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateProduct(id: string, body: UpdateProductRequest): Promise<AdminProductView> {
  return request<AdminProductView>(`/api/admin/v1/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function publishProduct(id: string): Promise<AdminProductView> {
  return request<AdminProductView>(`/api/admin/v1/products/${id}/publish`, { method: 'POST' });
}

export async function unpublishProduct(id: string): Promise<AdminProductView> {
  return request<AdminProductView>(`/api/admin/v1/products/${id}/unpublish`, { method: 'POST' });
}

// ---------- 库存 ----------

export async function adjustStock(id: string, body: StockAdjustmentRequest): Promise<StockAdjustmentResult> {
  return request<StockAdjustmentResult>(`/api/admin/v1/products/${id}/stock-adjustments`, { method: 'POST', body: JSON.stringify(body) });
}

export async function listStockMovements(id: string, page = 1, pageSize = 10): Promise<PageView<StockMovementView>> {
  return request<PageView<StockMovementView>>(`/api/admin/v1/products/${id}/stock-movements?page=${page}&pageSize=${pageSize}`);
}

// ---------- 订单与拼单组（F018） ----------

export async function listAdminOrders(query: { status?: string; keyword?: string; page?: number; pageSize?: number } = {}): Promise<PageView<AdminOrderListItem>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.keyword) params.set('keyword', query.keyword);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 10));
  return request<PageView<AdminOrderListItem>>(`/api/admin/v1/orders?${params.toString()}`);
}

export async function getAdminOrder(id: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/api/admin/v1/orders/${id}`);
}

export async function listAdminGroups(query: { status?: string; page?: number; pageSize?: number } = {}): Promise<PageView<AdminGroupListItem>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 10));
  return request<PageView<AdminGroupListItem>>(`/api/admin/v1/groups?${params.toString()}`);
}

export async function getAdminGroup(id: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/api/admin/v1/groups/${id}`);
}

// ---------- 用户管理（F012） ----------

export async function listAdminUsers(query: { keyword?: string; status?: string; page?: number; pageSize?: number } = {}): Promise<PageView<AdminUserListItem>> {
  const params = new URLSearchParams();
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.status) params.set('status', query.status);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 10));
  return request<PageView<AdminUserListItem>>(`/api/admin/v1/users?${params.toString()}`);
}

export async function getAdminUser(id: string): Promise<AdminUserListItem> {
  return request<AdminUserListItem>(`/api/admin/v1/users/${id}`);
}

export async function revealAdminUserPhone(id: string): Promise<AdminPhoneReveal> {
  return request<AdminPhoneReveal>(`/api/admin/v1/users/${id}/phone`);
}

export async function disableAdminUser(id: string): Promise<AdminUserListItem> {
  return request<AdminUserListItem>(`/api/admin/v1/users/${id}/disable`, { method: 'POST' });
}

export async function enableAdminUser(id: string): Promise<AdminUserListItem> {
  return request<AdminUserListItem>(`/api/admin/v1/users/${id}/enable`, { method: 'POST' });
}

// ---------- 小程序侧核对（后台调试用） ----------

export async function listMiniProducts(page = 1, pageSize = 10): Promise<PageView<MiniProductListItem>> {
  return request<PageView<MiniProductListItem>>(`/api/mini/v1/products?page=${page}&pageSize=${pageSize}`, {}, null);
}

export async function getMiniProduct(id: string): Promise<MiniProductView> {
  return request<MiniProductView>(`/api/mini/v1/products/${id}`, {}, null);
}

/** 金额格式化：整数分 → "x.xx"；字符串运算，仅展示。 */
export function formatFen(fen: number): string {
  const sign = fen < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(fen));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ---------- 支付与退款（T006） ----------

export async function listAdminPayments(query: { status?: string; page?: number; pageSize?: number } = {}): Promise<PageView<AdminPaymentListItem>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 10));
  return request<PageView<AdminPaymentListItem>>(`/api/admin/v1/payments?${params.toString()}`);
}

export async function listAdminRefunds(query: { status?: string; page?: number; pageSize?: number } = {}): Promise<PageView<AdminRefundListItem>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 10));
  return request<PageView<AdminRefundListItem>>(`/api/admin/v1/refunds?${params.toString()}`);
}

export async function getPaymentAnomalies(): Promise<PaymentAnomaliesView> {
  return request<PaymentAnomaliesView>('/api/admin/v1/payment-anomalies');
}

export async function retryAdminRefund(id: string, reason: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/admin/v1/refunds/${id}/retry`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---------- 履约管理（T007） ----------

export async function listFulfillmentGroups(query: { status?: string; page?: number; pageSize?: number } = {}): Promise<PageView<AdminFulfillmentGroupSummary>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  params.set('page', String(query.page ?? 1));
  params.set('pageSize', String(query.pageSize ?? 10));
  return request<PageView<AdminFulfillmentGroupSummary>>(`/api/admin/v1/fulfillment/groups?${params.toString()}`);
}

export async function getFulfillmentGroup(id: string): Promise<{ groupId: string; items: AdminFulfillmentDetail[] }> {
  return request(`/api/admin/v1/fulfillment/groups/${id}`);
}

export async function shipFulfillmentOrder(id: string, body: { quantityGrams: number; company: string; trackingNo: string; isReissue?: boolean; reason?: string }): Promise<{ shipmentId: string; fulfillmentOrder: { id: string; status: string; shippedQuantityGrams: number } }> {
  return request(`/api/admin/v1/fulfillment/orders/${id}/shipments`, { method: 'POST', body: JSON.stringify(body) });
}

export async function completeFulfillmentOrder(id: string): Promise<{ fulfillmentOrder: { id: string; status: string; completedBy: string } }> {
  return request(`/api/admin/v1/fulfillment/orders/${id}/complete`, { method: 'POST', body: '{}' });
}

export function exportShipmentsCsv(groupId: string): string {
  return `/api/admin/v1/fulfillment/groups/${groupId}/shipments/export`;
}
