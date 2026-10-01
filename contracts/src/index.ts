/** 公开传输模型；不得依赖后端实体或框架。 */

// ---------- 通用包络 ----------

export interface ApiResponse<T> {
  data: T;
  requestId: string;
}

export interface ApiError {
  code: string;
  message: string;
  requestId: string;
  details?: string[];
}

export interface PageView<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------- 框架元数据（T001） ----------

export type ContextStatus = 'planned' | 'partial';

export interface ContextSummary {
  key: string;
  name: string;
  description: string;
  status: ContextStatus;
}

export interface PlatformInfo {
  name: string;
  stage: 'foundation';
  backend: 'NestJS / TypeScript';
  database: 'PostgreSQL';
  contexts: ContextSummary[];
  businessReady: false;
}

export interface HealthInfo {
  status: 'live' | 'ready';
  checkedAt: string;
}

// ---------- 后台身份与权限（F005） ----------

export type AdminRole = 'super_admin';

export type AdminPermission =
  | 'catalog:manage'
  | 'inventory:manage'
  | 'media:manage'
  | 'admin:manage'
  | 'user:manage'
  | 'order:manage';

export interface AdminProfile {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  permissions: AdminPermission[];
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  admin: AdminProfile;
}

// ---------- 图片资源（F006） ----------

export type MediaFormat = 'jpeg' | 'png' | 'webp';

export interface MediaAssetView {
  id: string;
  url: string;
  format: MediaFormat;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
}

export interface MediaAssetAdminView extends MediaAssetView {
  referencedByProducts: number;
}

// ---------- 份额与金额展示（F007） ----------

/** 份额选项的 60 单位制数值：1/2=30、1/3=20、1/4=15、1/5=12。 */
export type ShareUnits = 30 | 20 | 15 | 12;

export interface ShareOptionView {
  units: ShareUnits;
  fractionLabel: string;
  /** 份额对应数量（≤3 位小数字符串，展示舍入，非履约规则）。 */
  quantityText: string;
  /** 参考份额价（整数分，half-up；非支付报价）。 */
  referencePriceFen: number;
}

// ---------- 商品（F007 后台） ----------

export type ProductStatus = 'draft' | 'on_shelf' | 'off_shelf';

export type ProductStockStatus = 'available' | 'sold_out';

export interface ProductImageView {
  mediaId: string;
  url: string;
  role: 'main' | 'detail';
  sortOrder: number;
}

export interface AdminProductView {
  id: string;
  name: string;
  description: string;
  originalPriceFen: number;
  userWholePriceFen: number;
  wholeQuantity: string;
  unit: string;
  allowedShareUnits: ShareUnits[];
  shareOptions: ShareOptionView[];
  status: ProductStatus;
  stockStatus: ProductStockStatus;
  availableWholeItems: number;
  mainImage?: ProductImageView;
  detailImages: ProductImageView[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductListItem {
  id: string;
  name: string;
  originalPriceFen: number;
  wholeQuantity: string;
  unit: string;
  status: ProductStatus;
  stockStatus: ProductStockStatus;
  availableWholeItems: number;
  mainImageUrl?: string;
  createdAt: string;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  originalPriceFen: number;
  wholeQuantity: string;
  unit: string;
  allowedShareUnits: ShareUnits[];
  mainImageId?: string;
  detailImageIds?: string[];
  initialStockWholeItems: number;
}

export type UpdateProductRequest = Omit<CreateProductRequest, 'initialStockWholeItems'>;

// ---------- 库存（F007） ----------

export interface StockView {
  productId: string;
  availableWholeItems: number;
  /** 预留字段：本阶段恒为 0，整件预留属后续交易任务。 */
  reservedWholeItems: number;
  updatedAt: string;
}

export interface StockMovementView {
  id: string;
  productId: string;
  delta: number;
  resultingAvailable: number;
  reason: string;
  requestId?: string;
  createdAt: string;
}

export interface StockAdjustmentRequest {
  delta?: number;
  setTo?: number;
  reason: string;
  requestId?: string;
}

export interface StockAdjustmentResult {
  stock: StockView;
  movement?: StockMovementView;
  idempotentReplay: boolean;
}

// ---------- 小程序商品（F008） ----------

export interface MiniProductListItem {
  id: string;
  name: string;
  mainImageUrl?: string;
  originalPriceFen: number;
  userWholePriceFen: number;
  priceFromFen: number;
  stockStatus: ProductStockStatus;
}

export interface MiniProductView {
  id: string;
  name: string;
  description: string;
  mainImageUrl?: string;
  detailImageUrls: string[];
  originalPriceFen: number;
  userWholePriceFen: number;
  priceFromFen: number;
  wholeQuantity: string;
  unit: string;
  shareOptions: ShareOptionView[];
  stockStatus: ProductStockStatus;
}

// ---------- 小程序用户身份（F009/F010） ----------

export interface MiniUserView {
  id: string;
  nickname: string;
  hasPhone: boolean;
  phoneMasked?: string;
  phoneVerified?: boolean;
  status: 'active' | 'disabled';
  createdAt: string;
}

export interface MiniLoginResponse {
  token: string;
  expiresAt: string;
  isNewUser: boolean;
  user: MiniUserView;
}

export interface ProfileUpdateRequest {
  nickname: string;
}

export interface PhoneBindResult {
  hasPhone: true;
  phoneMasked: string;
  phoneVerified: true;
}

// ---------- 收货地址（F011） ----------

export interface AddressView {
  id: string;
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressSaveRequest {
  receiverName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
}

// ---------- 后台用户管理（F012） ----------

export interface AdminUserListItem {
  id: string;
  nickname: string;
  hasPhone: boolean;
  phoneMasked?: string;
  status: 'active' | 'disabled';
  createdAt: string;
  lastLoginAt?: string;
}

export interface AdminPhoneReveal {
  phone: string;
  countryCode: string;
}

// ---------- 订单与拼单（F015-F018） ----------

export interface OrderQuoteView {
  totalAmountFen: number;
  goodsAmountFen: number;
  serviceFeeFen: number;
  tailAdjustFen: number;
  isFinalOrder: boolean;
}

export interface OrderGroupSummary {
  groupId: string;
  status: 'open' | 'success' | 'failed';
  paidUnits: number;
  reservedUnits: number;
  remainingCapacity: number;
  deadline: string;
}

export interface MiniOrderView {
  id: string;
  orderNo: string;
  status: 'unpaid' | 'paid' | 'cancelled' | 'expired';
  units: number;
  productId: string;
  groupId: string;
  quote: OrderQuoteView;
  productSnapshot: { originalPriceFen: number; unit: string; wholeQuantityText: string; referenceQuantityText: string };
  addressSnapshot: { receiverName: string; phone: string; province: string; city: string; district: string; detail: string };
  groupSummary: OrderGroupSummary | null;
  reservationExpiresAt: string;
  paymentNotice: string;
  createdAt: string;
}

export interface PlaceOrderRequest {
  productId: string;
  units: number;
  addressId: string;
  idempotencyKey: string;
}

export interface AdminOrderListItem {
  id: string;
  orderNo: string;
  status: 'unpaid' | 'paid' | 'cancelled' | 'expired';
  units: number;
  nickname: string;
  totalAmountFen: number;
  createdAt: string;
}

export interface AdminGroupListItem {
  id: string;
  productId: string;
  status: 'open' | 'success' | 'failed';
  paidUnits: number;
  reservedUnits: number;
  remainingCapacity: number;
  deadline: string;
  createdAt: string;
}

// ---------- 支付与退款（T006） ----------

/** wx.requestPayment 所需签名参数（后端按商户私钥 RSA 签名）。 */
export interface MiniPayParams {
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: 'RSA';
  paySign: string;
}

/** 发起支付响应：processing=返回调起参数；unknown=渠道结果未定，稍后用 payment-result 查询。 */
export interface PayInitiation {
  paymentId: string;
  status: 'processing' | 'unknown';
  payParams?: MiniPayParams;
  message?: string;
}

export type RefundStatus = 'requested' | 'submitted' | 'processing' | 'succeeded' | 'failed';

/** 小程序退款进度（仅本人订单）。 */
export interface MiniRefundView {
  id: string;
  status: RefundStatus;
  amountFen: number;
  reason: string;
  createdAtText: string;
}

export type PaymentStatus = 'created' | 'processing' | 'unknown' | 'succeeded' | 'closed';

/** 后台支付列表行（脱敏；不含用户手机号）。 */
export interface AdminPaymentListItem {
  id: string;
  orderNo: string;
  status: PaymentStatus;
  amountFen: number;
  channelTransactionId?: string;
  appliedResult?: 'applied' | 'refunded_not_applied' | 'pending_review';
  createdAt: string;
}

/** 后台退款列表行（昵称为投影，手机号不展示）。 */
export interface AdminRefundListItem {
  id: string;
  orderNo: string;
  nickname: string;
  amountFen: number;
  status: RefundStatus;
  reason: string;
  retryCount: number;
  failReason?: string;
  createdAt: string;
}

export interface PaymentAnomaliesView {
  pendingReviewPayments: number;
  failedRefunds: number;
}

// ---------- 分份履约（T007） ----------

export type FulfillmentStatus = 'pending_shipment' | 'partially_shipped' | 'shipped' | 'completed';

export interface MiniShipmentView {
  id: string;
  quantityGrams: number;
  quantityText: string;
  isReissue: boolean;
  reissueReason: string | null;
  company: string;
  trackingNo: string;
  shippedAt: string;
}

/** 小程序履约进度（仅本人订单）。 */
export interface MiniFulfillmentView {
  fulfillmentOrderId: string;
  status: FulfillmentStatus;
  allocatedQuantityGrams: number;
  allocatedQuantityText: string;
  unit: string;
  shipments: MiniShipmentView[];
  receiverSnapshot: { name: string; phone: string; province: string; city: string; district: string; detail: string };
  completedBy: 'user' | 'admin' | null;
  completedAt: string | null;
}

export interface MiniFulfillmentResult {
  /** null = 尚未生成（组未成功或生成中）——前端空态 */
  fulfillmentOrder: MiniFulfillmentView | null;
  groupSummary: { groupId: string; status: string } | null;
}

/** 后台履约组摘要（列表行）。 */
export interface AdminFulfillmentGroupSummary {
  groupId: string;
  productId: string;
  productName: string;
  succeededAt: string;
  total: number;
  pending: number;
  partially: number;
  shipped: number;
  completed: number;
}

export interface AdminShipmentView {
  id: string;
  quantityGrams: number;
  quantityText: string;
  isReissue: boolean;
  reissueReason: string | null;
  company: string;
  trackingNo: string;
  shippedAt: string;
}

/** 后台履约组明细行（电话脱敏）。 */
export interface AdminFulfillmentDetail {
  fulfillmentOrderId: string;
  orderId: string;
  orderNo: string;
  nickname: string;
  units: number;
  allocatedQuantityGrams: number;
  allocatedQuantityText: string;
  unit: string;
  status: FulfillmentStatus;
  receiver: { name: string; phoneMasked: string; province: string; city: string; district: string; detail: string; version: number };
  shipments: AdminShipmentView[];
}
