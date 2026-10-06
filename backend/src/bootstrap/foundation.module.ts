import { AiSupportController } from '../contexts/customer-service/adapters/inbound/ai-support/ai-support.controller';
import { AiSupportService } from '../contexts/customer-service/application/ai-support/service';
import { PostgresAiSupportRepository } from '../contexts/customer-service/adapters/outbound/postgres/ai-support-repository';
import { PiReplyAdapter, piSupportConfig } from '../contexts/customer-service/adapters/outbound/pi/pi-reply-adapter';
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Pool } from 'pg';
import { CheckReadiness } from '../platform/application/check-readiness/check-readiness';
import { DescribePlatform } from '../platform/application/describe-platform/describe-platform';
import { DATABASE_PROBE, type DatabaseProbe } from '../platform/application/ports/database-probe';
import { HealthController } from '../platform/adapters/inbound/health/health.controller';
import { PlatformController } from '../platform/adapters/inbound/describe-platform/platform.controller';
import { PostgresProbe } from '../platform/adapters/outbound/postgres/postgres-probe';
import { SystemClock } from '../shared/kernel';
import { PostgresTransactionRunner } from '../adapters-shared/transaction-runner';
import { AccessGuard } from '../contexts/identity-access/adapters/inbound/admin/access.guard';
import { AuthController } from '../contexts/identity-access/adapters/inbound/admin/auth.controller';
import {
  AuthenticateAdmin,
  CreateOrUpdateInitialAdmin,
  LoginAdmin,
  LogoutAdmin,
  type AdminRepository,
  type AdminTokenService,
  type PasswordHasher,
  type SessionRepository
} from '../contexts/identity-access/application';
import {
  AuthenticateUser,
  BindPhone,
  CreateAddress,
  DeleteAddress,
  ListMyAddresses,
  LoginWithWechat,
  LogoutUser,
  SetDefaultAddress,
  UpdateAddress,
  UpdateProfile,
  type UserSessionRepository,
  type UserRepository,
  type WechatIdentityRepository,
  type UserTokenService,
  type AddressRepository
} from '../contexts/identity-access/application/user';
import {
  DisableUser,
  EnableUser,
  GetAdminUser,
  ListAdminUsers,
  RevealUserPhone
} from '../contexts/identity-access/application/user/admin-users';
import { PostgresUserRepository, PostgresWechatIdentityRepository, PostgresUserSessionRepository, PostgresAddressRepository } from '../contexts/identity-access/adapters/outbound/postgres/user-repositories';
import { HttpWxAuthAdapter, HttpWxAccessTokenAdapter, HttpWxPhoneAdapter } from '../contexts/identity-access/adapters/outbound/wechat/wx-http.adapters';
import { MiniAuthController } from '../contexts/identity-access/adapters/inbound/mini/mini-auth.controller';
import { MiniProfileController, MiniAddressesController } from '../contexts/identity-access/adapters/inbound/mini/mini-user.controller';
import { AdminUsersController } from '../contexts/identity-access/adapters/inbound/admin/users.controller';
import { LoginThrottle } from '../contexts/identity-access/domain/login-throttle';
import { PostgresAdminRepository } from '../contexts/identity-access/adapters/outbound/postgres/admin-repository';
import { PostgresSessionRepository } from '../contexts/identity-access/adapters/outbound/postgres/session-repository';
import { ScryptPasswordHasher } from '../contexts/identity-access/adapters/outbound/crypto/scrypt-password-hasher';
import { TokenService } from '../contexts/identity-access/adapters/outbound/crypto/token-service';
import { RecordOperation, type OperationLogRepository } from '../contexts/audit/application';
import { PostgresOperationLogRepository } from '../contexts/audit/adapters/outbound/postgres/operation-log-repository';
import { AdminMediaController } from '../contexts/catalog/adapters/inbound/admin/media.controller';
import { MediaAccessController } from '../contexts/catalog/adapters/inbound/public/media-access.controller';
import { AdminProductsController } from '../contexts/catalog/adapters/inbound/admin/products.controller';
import { MiniProductsController } from '../contexts/catalog/adapters/inbound/mini/mini-products.controller';
import {
  CreateProductDraft,
  DeleteMediaAsset,
  ImageInspector,
  ListMediaAssets,
  PublishProduct,
  ReadMediaAsset,
  UnpublishProduct,
  UpdateProduct,
  UploadMediaAsset,
  type ImageStorage,
  type MediaRepository,
  type MediaUrlBuilder,
  type ProductRepository
} from '../contexts/catalog/application';
import { PostgresMediaRepository } from '../contexts/catalog/adapters/outbound/postgres/media-repository';
import { PostgresProductRepository } from '../contexts/catalog/adapters/outbound/postgres/product-repository';
import { LocalImageStorage } from '../contexts/catalog/adapters/outbound/storage/local-image-storage';
import { ConfigMediaUrlBuilder } from '../contexts/catalog/adapters/outbound/url/config-media-url-builder';
import { AdminStockController } from '../contexts/inventory/adapters/inbound/admin/stock.controller';
import { AdjustStock, ListStockMovements, type StockRepository } from '../contexts/inventory/application';
import { PostgresStockRepository } from '../contexts/inventory/adapters/outbound/postgres/stock-repository';
import { AdminCatalogQueries, CreateProductWorkflow, MiniCatalogQueries, PublishProductWorkflow } from '../workflows';
import { CancelUnpaidOrder, PlaceOrderWorkflow } from '../workflows/order-place.workflow';
import { OrderNumber } from '../contexts/ordering/domain/order';
import { PostgresGroupRepository, PostgresShareReservationRepository } from '../contexts/group-buying/adapters/outbound/postgres/group-repositories';
import { PostgresOrderRepository } from '../contexts/ordering/adapters/outbound/postgres/order-repository';
import type { OrderRepository } from '../contexts/ordering/application/order-ports';
import { MiniOrdersController } from '../contexts/ordering/adapters/inbound/mini/mini-orders.controller';
import { AdminOrderGroupController } from '../contexts/ordering/adapters/inbound/admin/admin-order-group.controller';
import { AdminOrderQueries, AdminGroupQueries } from '../contexts/ordering/application/admin-views';
import { getProductSnapshotPort, getStockReservationPort } from '../contexts/catalog/adapters/outbound/catalog-stock-adapters';
import { PostgresPaymentRepository } from '../contexts/payments/adapters/outbound/postgres/payment-repository';
import { MiniPayController } from '../contexts/payments/adapters/inbound/mini/mini-pay.controller';
import { NotifyController } from '../contexts/payments/adapters/inbound/public/payment-notify.controller';
import { AdminPayRefundController } from '../contexts/payments/adapters/inbound/admin/admin-pay-refund.controller';
import { InitiatePayment, PaymentQueryResult } from '../contexts/payments/application';
import { MarkPaymentNotAppliedRefunder } from '../contexts/payments/application/apply-payment';
import { HttpWxPayAdapter } from '../contexts/payments/adapters/outbound/wechat/wx-pay.adapter';
import { WxPayNotifyVerifier } from '../contexts/payments/adapters/outbound/wechat/wx-pay-notify-verifier';
import { PostgresRefundRepository } from '../contexts/payments/adapters/outbound/postgres/refund-repository';
import { ConfirmPaymentWorkflow } from '../workflows/payment-confirm.workflow';
import { CreateFullRefundUseCase, CancelPaidOrderWorkflow, RetryRefund, RefundResultConfirmer } from '../contexts/payments/application/refund-flow';
import { MiniRefundQueries } from '../contexts/payments/application/mini-refund-views';
import { ShipFulfillmentUseCase, UpdateReceiverUseCase, CompleteFulfillmentUseCase } from '../contexts/fulfillment/application/admin-fulfillment';
import { AdminFulfillmentQueries } from '../contexts/fulfillment/application/admin-fulfillment-queries';
import { MiniFulfillmentQueries, ConfirmReceiptUseCase } from '../contexts/fulfillment/application/mini-fulfillment';
import { PostgresFulfillmentRepository } from '../contexts/fulfillment/adapters/outbound/postgres/fulfillment-repository';
import { TransactionalFulfillmentAudit } from '../contexts/fulfillment/adapters/outbound/postgres/fulfillment-audit';
import { AdminFulfillmentController } from '../contexts/fulfillment/adapters/inbound/admin/fulfillment.controller';
import { MiniFulfillmentController } from '../contexts/fulfillment/adapters/inbound/mini/mini-fulfillment.controller';
import { PostgresConversationRepository } from '../contexts/customer-service/adapters/outbound/postgres/conversation-repository';
import { PostgresTicketRepository } from '../contexts/after-sales/adapters/outbound/postgres/ticket-repository';
import{ApprovalService}from'../contexts/after-sales/application/approval';
import{PostgresApprovalRepository}from'../contexts/after-sales/adapters/outbound/postgres/approval-repository';
import{ApprovalController}from'../contexts/after-sales/adapters/inbound/approval.controller';
import{AfterSalesFulfillmentService}from'../contexts/fulfillment/application/after-sales-fulfillment';
import{ReviewedAfterSalesEffects}from'../workflows/reviewed-after-sales.effects';
import { CreateConversationUseCase, AppendMessageUseCase, ListMessagesUseCase } from '../contexts/customer-service/application/conversation-usecases';
import { CardProjectionUseCase } from '../contexts/customer-service/application/card-projection';
import { withExecutor, type PgExecutor } from '../adapters-shared/pg-client';
import { ManageCsAccounts } from '../contexts/identity-access/application/cs-accounts';
import { PostgresCsAccountRepository } from '../contexts/identity-access/adapters/outbound/postgres/cs-account-repository';
import { CsAccountsController } from '../contexts/identity-access/adapters/inbound/admin/cs-accounts.controller';
import { ChatMediaUseCase } from '../contexts/customer-service/application/chat-media';
import { ChatMediaController } from '../contexts/customer-service/adapters/inbound/chat-media.controller';
import { PostgresChatImageRepository } from '../contexts/customer-service/adapters/outbound/postgres/chat-image-repository';
import { isPositiveSaleAllocation } from '../contexts/fulfillment/domain/quantity-allocation';
import { AcceptConversationUseCase, TransferConversationUseCase, EndConversationUseCase, AgentHeartbeatUseCase } from '../contexts/customer-service/application/agent-usecases';
import { CreateTicketUseCase, ProcessTicketUseCase } from '../contexts/after-sales/application/ticket-usecases';
import { ConvertConversationToTicketUseCase } from '../contexts/after-sales/application/ticket-coordination';
import { MiniCsController, AdminCsController } from '../contexts/customer-service/adapters/inbound/cs-controllers';
import { MiniCardController } from '../contexts/customer-service/adapters/inbound/mini-card.controller';
import { ApplicationError } from '../shared/kernel';
import { AdminPayRefundQueries } from '../contexts/payments/application/admin-pay-refund-queries';
import { ReportingController } from '../contexts/reporting/adapters/inbound/admin/reporting.controller';
import { ReportingQueries, type ReportingReadModel } from '../contexts/reporting/application/reporting-queries';
import { PostgresReportingReadModel } from '../contexts/reporting/adapters/outbound/postgres/reporting-read-model';
import { NotificationAdminController } from '../contexts/notifications/adapters/inbound/admin/notification-admin.controller';
import { AuditController } from '../contexts/audit/adapters/inbound/admin/audit.controller';
import { AuditLogQueries } from '../contexts/audit/application/audit-queries';
import { PostgresOperationLogQuery } from '../contexts/audit/adapters/outbound/postgres/operation-log-query';
import { NotificationMiniController } from '../contexts/notifications/adapters/inbound/mini/notification-mini.controller';
import { PostgresNotificationRepository } from '../contexts/notifications/adapters/outbound/postgres/notification-repository';
import { PostgresNotificationScanPort } from '../contexts/notifications/adapters/outbound/postgres/scan-ports';
import { UnconfiguredChannelAdapter } from '../contexts/notifications/adapters/outbound/channel/unconfigured-channel';
import { RecordNotification } from '../contexts/notifications/application/record-notification';
import { DriveDeliveries } from '../contexts/notifications/application/delivery-driver';
import { RetryDelivery } from '../contexts/notifications/application/retry-delivery';
import { ScanTimeoutConversations } from '../contexts/notifications/application/timeout-reminder';
import { CatchUpBusinessEvents } from '../contexts/notifications/application/event-catchup';
import type { NotificationRepository } from '../contexts/notifications/application/ports';
import { contexts } from './context-registry';
import { readConfig } from './config';
import type { RuntimeConfig } from './config';
import { TOKENS } from './injection-tokens';

/** 装配层：绑定端口实现与用例；领域与应用不感知 DI。 */
@Module({
  controllers: [
    ApprovalController,
    HealthController,
    PlatformController,
    AuthController,
    AdminMediaController,
    MediaAccessController,
    AdminProductsController,
    MiniProductsController,
    AdminStockController,
    MiniAuthController,
    MiniProfileController,
    MiniAddressesController,
    AdminUsersController,
    MiniOrdersController,
    MiniPayController,
    NotifyController,
    AdminOrderGroupController,
    AdminPayRefundController,
    AdminFulfillmentController,
    MiniFulfillmentController,
    MiniCsController,
    AiSupportController,
    AdminCsController,
    MiniCardController,
    ChatMediaController,
    CsAccountsController,
    ReportingController,
    NotificationAdminController,
    NotificationMiniController,
    AuditController,
  ],
  providers: [
    {provide:AiSupportService,useFactory:(pool:Pool)=>new AiSupportService({repository:new PostgresAiSupportRepository(pool),model:new PiReplyAdapter(piSupportConfig())}),inject:[TOKENS.PgPool]},
    { provide: TOKENS.PgPool, useFactory: () => new Pool({ connectionString: readConfig().databaseUrl, max: 10 }) },
    { provide: TOKENS.Clock, useFactory: () => new SystemClock() },
    { provide: 'CLOCK', useExisting: TOKENS.Clock },
    // 平台
    { provide: DATABASE_PROBE, useFactory: () => new PostgresProbe(readConfig().databaseUrl) },
    { provide: CheckReadiness, useFactory: (db: DatabaseProbe) => new CheckReadiness(db), inject: [DATABASE_PROBE] },
    { provide: DescribePlatform, useFactory: () => new DescribePlatform(contexts) },
    // 身份权限
    { provide: TOKENS.AdminRepository, useFactory: (pool: Pool) => new PostgresAdminRepository(pool), inject: [TOKENS.PgPool] },
    { provide: TOKENS.SessionRepository, useFactory: (pool: Pool) => new PostgresSessionRepository(pool), inject: [TOKENS.PgPool] },
    { provide: TOKENS.PasswordHasher, useFactory: () => new ScryptPasswordHasher() },
    { provide: TOKENS.AdminTokenService, useFactory: () => new TokenService() },
    { provide: TOKENS.LoginThrottle, useFactory: () => new LoginThrottle({ maxAttempts: 5, lockWindowMs: 15 * 60_000 }) },
    {
      provide: LoginAdmin,
      useFactory: (admins: AdminRepository, sessions: SessionRepository, hasher: PasswordHasher, tokens: AdminTokenService, clock: SystemClock, throttle: LoginThrottle) =>
        new LoginAdmin({ admins, sessions, hasher, tokens, clock, sessionTtlMinutes: readConfig().adminSessionTtlMinutes, throttle }),
      inject: [TOKENS.AdminRepository, TOKENS.SessionRepository, TOKENS.PasswordHasher, TOKENS.AdminTokenService, TOKENS.Clock, TOKENS.LoginThrottle]
    },
    { provide: LogoutAdmin, useFactory: (sessions: SessionRepository, clock) => new LogoutAdmin({ sessions, clock }), inject: [TOKENS.SessionRepository, TOKENS.Clock] },
    { provide: AuthenticateAdmin, useFactory: (admins, sessions, tokens, clock) => new AuthenticateAdmin({ admins, sessions, tokens, clock }), inject: [TOKENS.AdminRepository, TOKENS.SessionRepository, TOKENS.AdminTokenService, TOKENS.Clock] },
    { provide: CreateOrUpdateInitialAdmin, useFactory: (admins, sessions, hasher, clock) => new CreateOrUpdateInitialAdmin({ admins, sessions, hasher, clock }), inject: [TOKENS.AdminRepository, TOKENS.SessionRepository, TOKENS.PasswordHasher, TOKENS.Clock] },
    { provide: AccessGuard, useFactory: (reflector: Reflector, authenticateAdmin: AuthenticateAdmin, authenticateUser: AuthenticateUser) => new AccessGuard(reflector, authenticateAdmin, authenticateUser), inject: [Reflector, AuthenticateAdmin, AuthenticateUser] },
    { provide: APP_GUARD, useExisting: AccessGuard },
    // 用户身份（T003）
    { provide: 'USER_REPOSITORY', useFactory: (pool: Pool) => new PostgresUserRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'WECHAT_IDENTITY_REPOSITORY', useFactory: (pool: Pool) => new PostgresWechatIdentityRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'USER_SESSION_REPOSITORY', useFactory: (pool: Pool) => new PostgresUserSessionRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'ADDRESS_REPOSITORY', useFactory: (pool: Pool) => new PostgresAddressRepository(pool), inject: [TOKENS.PgPool] },
    // AddressRepository 符号别名（T004 地址归属端口使用）
    { provide: TOKENS.AddressRepository, useExisting: 'ADDRESS_REPOSITORY' },
    { provide: 'USER_TOKEN_SERVICE', useFactory: () => new TokenService() },
    { provide: HttpWxAuthAdapter, useFactory: () => new HttpWxAuthAdapter(readConfig()) },
    { provide: HttpWxAccessTokenAdapter, useFactory: () => new HttpWxAccessTokenAdapter(readConfig()) },
    { provide: HttpWxPhoneAdapter, useFactory: (tokens: HttpWxAccessTokenAdapter) => new HttpWxPhoneAdapter(tokens), inject: [HttpWxAccessTokenAdapter] },
    {
      provide: LoginWithWechat,
      useFactory: (users, identities, sessions, tokens, wxAuth, clock, pool: Pool) =>
        new LoginWithWechat({ users, identities, sessions, tokens, wxAuth, clock, sessionTtlMinutes: readConfig().userSessionTtlMinutes, runner: new PostgresTransactionRunner(pool) }),
      inject: ['USER_REPOSITORY', 'WECHAT_IDENTITY_REPOSITORY', 'USER_SESSION_REPOSITORY', 'USER_TOKEN_SERVICE', HttpWxAuthAdapter, TOKENS.Clock, TOKENS.PgPool]
    },
    { provide: AuthenticateUser, useFactory: (users, sessions, tokens, clock) => new AuthenticateUser({ users, sessions, tokens, clock }), inject: ['USER_REPOSITORY', 'USER_SESSION_REPOSITORY', 'USER_TOKEN_SERVICE', TOKENS.Clock] },
    { provide: LogoutUser, useFactory: (sessions, clock) => new LogoutUser({ sessions, clock }), inject: ['USER_SESSION_REPOSITORY', TOKENS.Clock] },
    { provide: BindPhone, useFactory: (users, identities, wxPhone, clock) => new BindPhone({ users, identities, wxPhone, clock }), inject: ['USER_REPOSITORY', 'WECHAT_IDENTITY_REPOSITORY', HttpWxPhoneAdapter, TOKENS.Clock] },
    { provide: UpdateProfile, useFactory: (users, clock) => new UpdateProfile({ users, clock }), inject: ['USER_REPOSITORY', TOKENS.Clock] },
    { provide: ListMyAddresses, useFactory: (addresses) => new ListMyAddresses({ addresses }), inject: ['ADDRESS_REPOSITORY'] },
    { provide: CreateAddress, useFactory: (addresses, clock) => new CreateAddress({ addresses, clock }), inject: ['ADDRESS_REPOSITORY', TOKENS.Clock] },
    { provide: UpdateAddress, useFactory: (addresses, clock) => new UpdateAddress({ addresses, clock }), inject: ['ADDRESS_REPOSITORY', TOKENS.Clock] },
    { provide: DeleteAddress, useFactory: (addresses, clock) => new DeleteAddress({ addresses, clock }), inject: ['ADDRESS_REPOSITORY', TOKENS.Clock] },
    {
      provide: SetDefaultAddress,
      useFactory: (addresses, users, pool: Pool) => new SetDefaultAddress({ addresses, users, runner: new PostgresTransactionRunner(pool) }),
      inject: ['ADDRESS_REPOSITORY', 'USER_REPOSITORY', TOKENS.PgPool]
    },
    // 后台用户管理（F012）
    {
      provide: ListAdminUsers,
      useFactory: (users, sessions, audit, clock) => new ListAdminUsers({ users, sessions, audit, clock }),
      inject: ['USER_REPOSITORY', 'USER_SESSION_REPOSITORY', RecordOperation, TOKENS.Clock]
    },
    {
      provide: GetAdminUser,
      useFactory: (users, sessions, audit, clock) => new GetAdminUser({ users, sessions, audit, clock }),
      inject: ['USER_REPOSITORY', 'USER_SESSION_REPOSITORY', RecordOperation, TOKENS.Clock]
    },
    {
      provide: RevealUserPhone,
      useFactory: (users, sessions, audit, clock) => new RevealUserPhone({ users, sessions, audit, clock }),
      inject: ['USER_REPOSITORY', 'USER_SESSION_REPOSITORY', RecordOperation, TOKENS.Clock]
    },
    {
      provide: DisableUser,
      useFactory: (users, sessions, audit, clock) => new DisableUser({ users, sessions, audit, clock }),
      inject: ['USER_REPOSITORY', 'USER_SESSION_REPOSITORY', RecordOperation, TOKENS.Clock]
    },
    {
      provide: EnableUser,
      useFactory: (users, sessions, audit, clock) => new EnableUser({ users, sessions, audit, clock }),
      inject: ['USER_REPOSITORY', 'USER_SESSION_REPOSITORY', RecordOperation, TOKENS.Clock]
    },
    // 审计
    { provide: TOKENS.OperationLogRepository, useFactory: (pool: Pool) => new PostgresOperationLogRepository(pool), inject: [TOKENS.PgPool] },
    { provide: RecordOperation, useFactory: (repository: OperationLogRepository, clock) => new RecordOperation({ repository, clock }), inject: [TOKENS.OperationLogRepository, TOKENS.Clock] },
    // 商品目录：媒体
    { provide: TOKENS.ImageStorage, useFactory: () => new LocalImageStorage(readConfig().mediaDir) },
    { provide: TOKENS.MediaRepository, useFactory: (pool: Pool) => new PostgresMediaRepository(pool), inject: [TOKENS.PgPool] },
    { provide: TOKENS.MediaUrlBuilder, useFactory: () => new ConfigMediaUrlBuilder(readConfig().publicApiBaseUrl) },
    { provide: ImageInspector, useFactory: () => new ImageInspector() },
    { provide: UploadMediaAsset, useFactory: (storage: ImageStorage, repository: MediaRepository, urlBuilder: MediaUrlBuilder, inspector: ImageInspector, clock) => new UploadMediaAsset({ storage, repository, urlBuilder, inspector, clock }), inject: [TOKENS.ImageStorage, TOKENS.MediaRepository, TOKENS.MediaUrlBuilder, ImageInspector, TOKENS.Clock] },
    { provide: ListMediaAssets, useFactory: (repository: MediaRepository, urlBuilder: MediaUrlBuilder) => new ListMediaAssets({ repository, urlBuilder }), inject: [TOKENS.MediaRepository, TOKENS.MediaUrlBuilder] },
    { provide: DeleteMediaAsset, useFactory: (repository: MediaRepository, storage: ImageStorage, clock) => new DeleteMediaAsset({ repository, storage, clock }), inject: [TOKENS.MediaRepository, TOKENS.ImageStorage, TOKENS.Clock] },
    { provide: ReadMediaAsset, useFactory: (repository: MediaRepository, storage: ImageStorage) => new ReadMediaAsset({ repository, storage }), inject: [TOKENS.MediaRepository, TOKENS.ImageStorage] },
    // 商品目录：商品
    { provide: TOKENS.ProductRepository, useFactory: (pool: Pool) => new PostgresProductRepository(pool), inject: [TOKENS.PgPool] },
    { provide: CreateProductDraft, useFactory: (media: MediaRepository, clock) => new CreateProductDraft({ media, clock }), inject: [TOKENS.MediaRepository, TOKENS.Clock] },
    { provide: UpdateProduct, useFactory: (products: ProductRepository, media: MediaRepository, clock) => new UpdateProduct({ products, media, clock, validateAllocation: validateSalesAllocation }), inject: [TOKENS.ProductRepository, TOKENS.MediaRepository, TOKENS.Clock] },
    { provide: PublishProduct, useFactory: (products: ProductRepository, clock) => new PublishProduct({ products, clock, validateAllocation: validateSalesAllocation }), inject: [TOKENS.ProductRepository, TOKENS.Clock] },
    { provide: UnpublishProduct, useFactory: (products: ProductRepository, clock) => new UnpublishProduct({ products, clock }), inject: [TOKENS.ProductRepository, TOKENS.Clock] },
    // 库存
    { provide: TOKENS.StockRepository, useFactory: (pool: Pool) => new PostgresStockRepository(pool), inject: [TOKENS.PgPool] },
    { provide: AdjustStock, useFactory: (stocks: StockRepository, clock) => new AdjustStock({ stocks, clock }), inject: [TOKENS.StockRepository, TOKENS.Clock] },
    { provide: ListStockMovements, useFactory: (stocks: StockRepository) => new ListStockMovements({ stocks }), inject: [TOKENS.StockRepository] },
    // 订单与拼单（T004）
    { provide: 'GROUP_REPOSITORY', useFactory: (pool: Pool) => new PostgresGroupRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'SHARE_RESERVATION_REPOSITORY', useFactory: (pool: Pool) => new PostgresShareReservationRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'ORDER_REPOSITORY', useFactory: (pool: Pool) => new PostgresOrderRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'ADDRESS_OWNERSHIP_PORT', useFactory: (addresses: AddressRepository) => ({ getAddressForUser: (id: string, userId: string) => addresses.findById(id, userId).then((a) => a ? { addressId: a.state.addressId, receiverName: a.state.receiverName, phone: a.state.phone, province: a.state.province, city: a.state.city, district: a.state.district, detail: a.state.detail } : null) }), inject: [TOKENS.AddressRepository] },
    { provide: 'PRODUCT_SNAPSHOT_PORT', useFactory: (pool: Pool) => getProductSnapshotPort(pool), inject: [TOKENS.PgPool] },
    {
      provide: PlaceOrderWorkflow,
      useFactory: (groups, reservations, orders, addresses, products, stocks, pool: Pool, clock) =>
        new PlaceOrderWorkflow({
          groups, reservations, orders, addresses, products, stocks,
          runner: new PostgresTransactionRunner(pool),
          clock,
          reservationTtlMinutes: 15,
          generateId: () => crypto.randomUUID(),
          generateOrderNo: () => OrderNumber.generate(new Date(), () => Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join(''))
        }),
      inject: ['GROUP_REPOSITORY', 'SHARE_RESERVATION_REPOSITORY', 'ORDER_REPOSITORY', 'ADDRESS_OWNERSHIP_PORT', 'PRODUCT_SNAPSHOT_PORT', 'STOCK_RESERVATION_PORT', TOKENS.PgPool, TOKENS.Clock]
    },
    { provide: 'STOCK_RESERVATION_PORT', useFactory: (pool: Pool) => getStockReservationPort(pool), inject: [TOKENS.PgPool] },
    // 支付退款（T006）
    { provide: 'PAYMENT_REPOSITORY', useFactory: (pool: Pool) => new PostgresPaymentRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'PAY_CHANNEL_PORT', useFactory: () => new HttpWxPayAdapter(wxPayRuntime()), inject: [] },
    { provide: 'PAY_CONFIG', useFactory: (adapter: HttpWxPayAdapter) => ({ configured: adapter.configured, notifyUrl: adapter.notifyUrl }), inject: ['PAY_CHANNEL_PORT'] },
    {
      provide: InitiatePayment,
      useFactory: (orders, groups, payments, users, channel, pool: Pool, clock, payChannel: HttpWxPayAdapter) =>
        new InitiatePayment({
          // 聚合 → 支付端口投影（OrderForPaymentState），避免用例依赖订单聚合内部结构
          orders: {
            findById: async (id: string) => {
              const o = await orders.findById(id);
              if (!o) return null;
              const s = o.state;
              return { orderId: s.orderId, userId: s.userId, status: s.status, totalAmountFen: s.totalAmountFen, units: s.units, groupId: s.groupId, reservationExpiresAt: s.reservationExpiresAt };
            }
          },
          groups: {
            isJoinable: async (groupId: string) => {
              const g = await groups.findById(groupId);
              return Boolean(g && g.isOpen && g.state.deadline > new Date());
            }
          },
          payments, channel: payChannel, users,
          runner: new PostgresTransactionRunner(pool), clock,
          payConfig: { configured: payChannel.configured, notifyUrl: payChannel.notifyUrl }
        }),
      inject: ['ORDER_REPOSITORY', 'GROUP_REPOSITORY', 'PAYMENT_REPOSITORY', 'USER_OPENID_PORT', 'PAY_CHANNEL_PORT', TOKENS.PgPool, TOKENS.Clock, 'PAY_CHANNEL_PORT']
    },
    { provide: 'USER_OPENID_PORT', useFactory: (identities) => ({ getOpenid: async (userId: string) => { const r = await identities.findByUserId(userId); return r?.state.openid ?? null; } }), inject: ['WECHAT_IDENTITY_REPOSITORY'] },
    { provide: PaymentQueryResult, useFactory: (payments, orders, payConfig, channel, confirm) => new PaymentQueryResult({ payments, orders, payConfig, channel, confirm }), inject: ['PAYMENT_REPOSITORY', 'ORDER_REPOSITORY', 'PAY_CONFIG', 'PAY_CHANNEL_PORT', 'PAYMENT_CONFIRM_WORKFLOW'] },
    { provide: 'NOTIFY_VERIFIER', useFactory: () => new WxPayNotifyVerifier({ configured: wxPayRuntime().configured, apiV3Key: wxPayRuntime().apiV3Key, mchid: wxPayRuntime().mchid, platformPublicKeyPath: wxPayRuntime().platformPublicKeyPath }) },
    {
      provide: 'PAYMENT_CONFIRM_WORKFLOW',
      useFactory: (payments, groups, reservations, orders, stocks, refunds, pool: Pool, clock) =>
        new ConfirmPaymentWorkflow({ groups, reservations, orders, payments, refunds: { createFullRefund: (i, tx) => refunds.execute(i, tx) }, stocks, runner: new PostgresTransactionRunner(pool), clock }),
      inject: ['PAYMENT_REPOSITORY', 'GROUP_REPOSITORY', 'SHARE_RESERVATION_REPOSITORY', 'ORDER_REPOSITORY', 'STOCK_RESERVATION_PORT', 'REFUND_CREATOR', TOKENS.PgPool, TOKENS.Clock]
    },
    {
      provide: 'NOTIFY_APPLIER',
      useFactory: (confirm, refundRepo, pool: Pool, clock) => {
        const refundConfirmer = new RefundResultConfirmer({ refunds: refundRepo, runner: new PostgresTransactionRunner(pool), clock });
        return {
          apply: async (fact: { outTradeNo: string; channelTransactionId: string; payerTotal: number; payload: Record<string, unknown> }) => confirm.execute({ channelFact: fact, source: 'callback' }),
          applyRefund: async (fact: { outRefundNo: string; result: 'SUCCESS' | 'ABNORMAL' | 'CLOSED' | 'PROCESSING'; channelRefundId?: string }) => refundConfirmer.execute({ ...fact, source: 'callback' })
        };
      },
      inject: ['PAYMENT_CONFIRM_WORKFLOW', 'REFUND_REPOSITORY', TOKENS.PgPool, TOKENS.Clock]
    },
    { provide: 'REFUND_CREATOR', useFactory: (refunds, payments, clock) => new CreateFullRefundUseCase({ refunds, payments, clock }), inject: ['REFUND_REPOSITORY', 'PAYMENT_REPOSITORY', TOKENS.Clock] },
    { provide: MiniRefundQueries, useFactory: (payments, refunds) => new MiniRefundQueries({ payments, refunds }), inject: ['PAYMENT_REPOSITORY', 'REFUND_REPOSITORY'] },
    { provide: RetryRefund, useFactory: (refunds, channel, audit, pool: Pool, clock) => new RetryRefund({ refunds, channel, audit, runner: new PostgresTransactionRunner(pool), clock }), inject: ['REFUND_REPOSITORY', 'PAY_CHANNEL_PORT', RecordOperation, TOKENS.PgPool, TOKENS.Clock] },
    { provide: CancelUnpaidOrder, useFactory: (orders, reservations, groups, clock, pool: Pool) => new CancelUnpaidOrder({ orders, reservations, groups, clock, runner: new PostgresTransactionRunner(pool) }), inject: ['ORDER_REPOSITORY', 'SHARE_RESERVATION_REPOSITORY', 'GROUP_REPOSITORY', TOKENS.Clock, TOKENS.PgPool] },
    { provide: CancelPaidOrderWorkflow, useFactory: (groups, orders, payments, refunds, creator, pool: Pool, clock) => new CancelPaidOrderWorkflow({ groups, orders, payments, refunds, creator, runner: new PostgresTransactionRunner(pool), clock }), inject: ['GROUP_REPOSITORY', 'ORDER_REPOSITORY', 'PAYMENT_REPOSITORY', 'REFUND_REPOSITORY', 'REFUND_CREATOR', TOKENS.PgPool, TOKENS.Clock] },
    { provide: 'REFUND_REPOSITORY', useFactory: (pool: Pool) => new PostgresRefundRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'ADMIN_ORDER_QUERIES', useFactory: (orders: OrderRepository, users) => new AdminOrderQueries({ orders, nicknameOf: (userId: string) => users.findById(userId).then((u: { state: { nickname: string } } | null) => u?.state.nickname ?? '（已注销）') }), inject: ['ORDER_REPOSITORY', 'USER_REPOSITORY'] },
    { provide: 'ADMIN_GROUP_QUERIES', useFactory: (groups, reservations, orders, users) => new AdminGroupQueries({ groups, reservations, orders, nicknameOf: (userId: string) => users.findById(userId).then((u: { state: { nickname: string } } | null) => u?.state.nickname ?? '（已注销）') }), inject: ['GROUP_REPOSITORY', 'SHARE_RESERVATION_REPOSITORY', 'ORDER_REPOSITORY', 'USER_REPOSITORY'] },
    { provide: 'ADMIN_PAY_REFUND_QUERIES', useFactory: (payments, refunds, users) => new AdminPayRefundQueries({ payments, refunds, nicknameOf: (userId: string) => users.findById(userId).then((u: { state: { nickname: string } } | null) => u?.state.nickname ?? '（已注销）') }), inject: ['PAYMENT_REPOSITORY', 'REFUND_REPOSITORY', 'USER_REPOSITORY'] },
    // T007 履约（F027-F030）
    { provide: 'FULFILLMENT_ORDER_REPOSITORY', useFactory: (pool: Pool) => new PostgresFulfillmentRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'FULFILLMENT_AUDIT', useFactory: (pool: Pool) => new TransactionalFulfillmentAudit(pool), inject: [TOKENS.PgPool] },
    { provide: ShipFulfillmentUseCase, useFactory: (repo, audit, pool: Pool, clock) => new ShipFulfillmentUseCase({ fulfillmentOrders: repo, audit, runner: new PostgresTransactionRunner(pool), clock }), inject: ['FULFILLMENT_ORDER_REPOSITORY', 'FULFILLMENT_AUDIT', TOKENS.PgPool, TOKENS.Clock] },
    { provide: UpdateReceiverUseCase, useFactory: (repo, audit, pool: Pool, clock) => new UpdateReceiverUseCase({ fulfillmentOrders: repo, audit, runner: new PostgresTransactionRunner(pool), clock }), inject: ['FULFILLMENT_ORDER_REPOSITORY', 'FULFILLMENT_AUDIT', TOKENS.PgPool, TOKENS.Clock] },
    { provide: CompleteFulfillmentUseCase, useFactory: (repo, audit, pool: Pool, clock) => new CompleteFulfillmentUseCase({ fulfillmentOrders: repo, audit, runner: new PostgresTransactionRunner(pool), clock }), inject: ['FULFILLMENT_ORDER_REPOSITORY', 'FULFILLMENT_AUDIT', TOKENS.PgPool, TOKENS.Clock] },
    { provide: 'ADMIN_FULFILLMENT_QUERIES', useFactory: (pool: Pool, users) => new AdminFulfillmentQueries(pool, (userId: string) => users.findById(userId).then((u: { state: { nickname: string } } | null) => u?.state.nickname ?? '（已注销）')), inject: [TOKENS.PgPool, 'USER_REPOSITORY'] },
    { provide: MiniFulfillmentQueries, useFactory: (orders, repo: PostgresFulfillmentRepository) => new MiniFulfillmentQueries({ orders, fulfillmentOrders: repo, shipments: repo, groups: repo }), inject: ['ORDER_REPOSITORY', 'FULFILLMENT_ORDER_REPOSITORY'] },
    { provide: ConfirmReceiptUseCase, useFactory: (repo, pool: Pool, clock) => new ConfirmReceiptUseCase({ fulfillmentOrders: repo, runner: new PostgresTransactionRunner(pool), clock }), inject: ['FULFILLMENT_ORDER_REPOSITORY', TOKENS.PgPool, TOKENS.Clock] },
    // T008 客服与售后工单（F031-F034）
    { provide: 'CS_CONVERSATION_REPOSITORY', useFactory: (pool: Pool) => new PostgresConversationRepository(pool), inject: [TOKENS.PgPool] },
    {provide:ManageCsAccounts,useFactory:(pool:Pool,hasher,audit,clock)=>new ManageCsAccounts({repository:new PostgresCsAccountRepository(pool),hasher,audit,clock,runner:new PostgresTransactionRunner(pool)}),inject:[TOKENS.PgPool,TOKENS.PasswordHasher,'FULFILLMENT_AUDIT',TOKENS.Clock]},
    { provide: 'AFTER_SALES_TICKET_REPOSITORY', useFactory: (pool: Pool) => new PostgresTicketRepository(pool), inject: [TOKENS.PgPool] },
    {provide:'AFTER_SALES_APPROVAL_REPOSITORY',useFactory:(pool:Pool)=>new PostgresApprovalRepository(pool),inject:[TOKENS.PgPool]},
    {provide:AfterSalesFulfillmentService,useFactory:(repo,ship)=>new AfterSalesFulfillmentService(repo,ship),inject:['FULFILLMENT_ORDER_REPOSITORY',ShipFulfillmentUseCase]},
    {provide:ReviewedAfterSalesEffects,useFactory:(orders,groups,payments,refunds,creator,fulfillment)=>new ReviewedAfterSalesEffects({orders,groups,payments,refunds,creator,fulfillment}),inject:['ORDER_REPOSITORY','GROUP_REPOSITORY','PAYMENT_REPOSITORY','REFUND_REPOSITORY','REFUND_CREATOR',AfterSalesFulfillmentService]},
    {provide:ApprovalService,useFactory:(requests,tickets,effects,audit,pool:Pool,clock)=>new ApprovalService({requests,tickets,effects,audit,runner:new PostgresTransactionRunner(pool),clock}),inject:['AFTER_SALES_APPROVAL_REPOSITORY','AFTER_SALES_TICKET_REPOSITORY',ReviewedAfterSalesEffects,'FULFILLMENT_AUDIT',TOKENS.PgPool,TOKENS.Clock]},
    { provide: CreateConversationUseCase, useFactory: (repo, pool: Pool, clock) => new CreateConversationUseCase({ conversations: repo, runner: new PostgresTransactionRunner(pool), clock }), inject: ['CS_CONVERSATION_REPOSITORY', TOKENS.PgPool, TOKENS.Clock] },
    { provide: ChatMediaUseCase, useFactory:(repo, pool:Pool, inspector, clock)=>new ChatMediaUseCase({conversations:repo,images:new PostgresChatImageRepository(pool),inspector,clock}),inject:['CS_CONVERSATION_REPOSITORY',TOKENS.PgPool,ImageInspector,TOKENS.Clock]},
    { provide: AppendMessageUseCase, useFactory: (repo, cards, media:ChatMediaUseCase, pool: Pool, clock) => new AppendMessageUseCase({ conversations: repo, authorizeCard: (userId, kind, id) => new CardProjectionUseCase(cards).execute(userId, kind, id), authorizeImage:(cid,id)=>media.assertAttachment(cid,id), runner: new PostgresTransactionRunner(pool), clock }), inject: ['CS_CONVERSATION_REPOSITORY', 'CARD_PROJECTION_DEPS', ChatMediaUseCase, TOKENS.PgPool, TOKENS.Clock] },
    { provide: ListMessagesUseCase, useFactory: (repo) => new ListMessagesUseCase({ conversations: repo, listMessages: (id: string, afterSeq: number, limit: number, includeInternal: boolean) => repo.listMessages(id, afterSeq, limit, includeInternal) }), inject: ['CS_CONVERSATION_REPOSITORY'] },
    { provide: AcceptConversationUseCase, useFactory: (repo, pool: Pool, clock) => new AcceptConversationUseCase({ conversations: repo, runner: new PostgresTransactionRunner(pool), clock }), inject: ['CS_CONVERSATION_REPOSITORY', TOKENS.PgPool, TOKENS.Clock] },
    { provide: TransferConversationUseCase, useFactory: (repo, audit, pool: Pool, clock) => new TransferConversationUseCase({ conversations: repo, presence: repo, runner: new PostgresTransactionRunner(pool), clock, audit }), inject: ['CS_CONVERSATION_REPOSITORY', 'FULFILLMENT_AUDIT', TOKENS.PgPool, TOKENS.Clock] },
    { provide: AgentHeartbeatUseCase, useFactory: (repo, pool: Pool, clock) => new AgentHeartbeatUseCase({ presence: repo, runner: new PostgresTransactionRunner(pool), clock }), inject: ['CS_CONVERSATION_REPOSITORY', TOKENS.PgPool, TOKENS.Clock] },
    { provide: EndConversationUseCase, useFactory: (repo, pool: Pool, clock) => new EndConversationUseCase({ conversations: repo, runner: new PostgresTransactionRunner(pool), clock }), inject: ['CS_CONVERSATION_REPOSITORY', TOKENS.PgPool, TOKENS.Clock] },
    { provide: 'CS_OWNED_REFERENCES', useFactory: (orders, reservations, conversations) => ({
        async assertOwned(input: { userId: string; orderId: string | null; groupId: string | null; conversationId: string | null }, tx: unknown) {
          await withExecutor(tx as PgExecutor,client=>client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[input.userId]));
          if (input.orderId) { const order = await orders.findById(input.orderId, tx); if (!order || order.state.userId !== input.userId) throw new ApplicationError('NOT_FOUND', '订单不存在'); }
          if (input.groupId && !(await reservations.listByGroup(input.groupId, tx)).some((r: { state: { userId: string } }) => r.state.userId === input.userId)) throw new ApplicationError('NOT_FOUND', '拼单组不存在');
          if (input.conversationId) { const conversation = await conversations.findById(input.conversationId, tx); if (!conversation || conversation.state.userId !== input.userId) throw new ApplicationError('NOT_FOUND', '会话不存在'); }
        }
      }), inject: ['ORDER_REPOSITORY', 'SHARE_RESERVATION_REPOSITORY', 'CS_CONVERSATION_REPOSITORY'] },
    { provide: CreateTicketUseCase, useFactory: (repo, references, pool: Pool, clock) => new CreateTicketUseCase({ tickets: repo, references, runner: new PostgresTransactionRunner(pool), clock }), inject: ['AFTER_SALES_TICKET_REPOSITORY', 'CS_OWNED_REFERENCES', TOKENS.PgPool, TOKENS.Clock] },
    { provide: ProcessTicketUseCase, useFactory: (repo, audit, pool: Pool, clock) => new ProcessTicketUseCase({ tickets: repo, audit, runner: new PostgresTransactionRunner(pool), clock }), inject: ['AFTER_SALES_TICKET_REPOSITORY', 'FULFILLMENT_AUDIT', TOKENS.PgPool, TOKENS.Clock] },
    { provide: ConvertConversationToTicketUseCase, useFactory: (tickets, conversations, references, audit, pool: Pool, clock) => new ConvertConversationToTicketUseCase({ tickets, conversations, references, audit, runner: new PostgresTransactionRunner(pool), clock }), inject: ['AFTER_SALES_TICKET_REPOSITORY', 'CS_CONVERSATION_REPOSITORY', 'CS_OWNED_REFERENCES', 'FULFILLMENT_AUDIT', TOKENS.PgPool, TOKENS.Clock] },
    { provide: 'MINI_CS_DEPS', useFactory: (create, append, list, repo, end, createTicket, tickets, processTicket,requests) => ({ create, append, list, conversations: repo, end, createTicket, tickets, processTicket,requests }), inject: [CreateConversationUseCase, AppendMessageUseCase, ListMessagesUseCase, 'CS_CONVERSATION_REPOSITORY', EndConversationUseCase, CreateTicketUseCase, 'AFTER_SALES_TICKET_REPOSITORY', ProcessTicketUseCase,'AFTER_SALES_APPROVAL_REPOSITORY'] },
    { provide: 'CARD_PROJECTION_DEPS', useFactory: (products, orders, groups, reservations, payments, refunds) => ({
        async listOptions(userId:string,kind:string) {
          if(kind==='product')return (await products.listOnShelf({page:1,pageSize:50})).items.map((p:{state:{productId:string;name:string}})=>({id:p.state.productId,label:p.state.name}));
          const items: Array<{state:{groupId:string;orderId:string;orderNo:string;totalAmountFen:number}}>=(await orders.listByUser(userId,1,50)).items;
          if(kind==='group')return [...new Map(items.map(o=>[o.state.groupId,{id:o.state.groupId,label:`订单 ${o.state.orderNo} 的拼单`}])).values()];
          return items.map(o=>({id:o.state.orderId,label:`${o.state.orderNo} · ${o.state.totalAmountFen/100}元`}));
        },
        product: { findById: (id: string) => products.findById(id) },
        orders: { findById: (id: string) => orders.findById(id) },
        groups: { findById: (id: string) => groups.findById(id) },
        orderBelongsTo: { findByGroupId: async (id: string) => (await reservations.listByGroup(id)).map((r: { state: { userId: string } }) => ({ state: { userId: r.state.userId } })) },
        payments: { findByOrderId: (id: string) => payments.findByOrderId(id) },
        refunds: { findByOrderId: (id: string) => refunds.findByOrderId(id) }
      }), inject: [TOKENS.ProductRepository, 'ORDER_REPOSITORY', 'GROUP_REPOSITORY', 'SHARE_RESERVATION_REPOSITORY', 'PAYMENT_REPOSITORY', 'REFUND_REPOSITORY'] },
    {provide:CardProjectionUseCase,useFactory:deps=>new CardProjectionUseCase(deps),inject:['CARD_PROJECTION_DEPS']},
    { provide: 'ADMIN_CS_DEPS', useFactory: (accept, transfer, end, append, list, repo, convertTicket, tickets, process, heartbeat, cards) => ({ accept, transfer, end, append, list, conversations: repo, convertTicket, tickets, process, heartbeat, cards }), inject: [AcceptConversationUseCase, TransferConversationUseCase, EndConversationUseCase, AppendMessageUseCase, ListMessagesUseCase, 'CS_CONVERSATION_REPOSITORY', ConvertConversationToTicketUseCase, 'AFTER_SALES_TICKET_REPOSITORY', ProcessTicketUseCase, AgentHeartbeatUseCase, CardProjectionUseCase] },
    // 运营看板（T009/F037）：只读统计投影
    { provide: 'REPORTING_READ_MODEL', useFactory: (pool: Pool) => new PostgresReportingReadModel(pool), inject: [TOKENS.PgPool] },
    {
      provide: 'REPORTING_QUERIES',
      useFactory: (readModel: ReportingReadModel, clock) => new ReportingQueries({ readModel, clock, overdueThresholdMinutes: readConfig().csFirstResponseTimeoutMinutes }),
      inject: ['REPORTING_READ_MODEL', TOKENS.Clock]
    },
    // 通知（T009/F038，D021/D022/D026）：渠道端口本轮为未配置适配器，真实订阅消息待凭证另接
    { provide: 'NOTIFICATION_REPOSITORY', useFactory: (pool: Pool) => new PostgresNotificationRepository(pool), inject: [TOKENS.PgPool] },
    { provide: 'NOTIFICATION_SCAN_PORT', useFactory: (pool: Pool) => new PostgresNotificationScanPort(pool), inject: [TOKENS.PgPool] },
    { provide: 'NOTIFICATION_CHANNEL', useFactory: () => new UnconfiguredChannelAdapter(), inject: [] },
    { provide: RecordNotification, useFactory: (repository: NotificationRepository, clock) => new RecordNotification({ repository, clock }), inject: ['NOTIFICATION_REPOSITORY', TOKENS.Clock] },
    { provide: DriveDeliveries, useFactory: (repository: NotificationRepository, channel, clock) => new DriveDeliveries({ repository, channels: [channel], clock }), inject: ['NOTIFICATION_REPOSITORY', 'NOTIFICATION_CHANNEL', TOKENS.Clock] },
    { provide: RetryDelivery, useFactory: (repository: NotificationRepository, audit, clock, pool: Pool) => new RetryDelivery({ repository, audit, clock, runner: new PostgresTransactionRunner(pool) }), inject: ['NOTIFICATION_REPOSITORY', RecordOperation, TOKENS.Clock, TOKENS.PgPool] },
    { provide: ScanTimeoutConversations, useFactory: (scanPort, recorder, clock) => new ScanTimeoutConversations({ scanPort, recorder, clock, thresholdMinutes: readConfig().csFirstResponseTimeoutMinutes }), inject: ['NOTIFICATION_SCAN_PORT', RecordNotification, TOKENS.Clock] },
    { provide: CatchUpBusinessEvents, useFactory: (scanPort, recorder) => new CatchUpBusinessEvents({ scanPort, recorder }), inject: ['NOTIFICATION_SCAN_PORT', RecordNotification] },
    // 审计查询（T009/F039）：admin_operation_logs 只读投影
    { provide: 'AUDIT_LOG_QUERIES', useFactory: (pool: Pool) => new AuditLogQueries({ queryPort: new PostgresOperationLogQuery(pool) }), inject: [TOKENS.PgPool] },
    // 跨上下文工作流
    {
      provide: CreateProductWorkflow,
      useFactory: (createDraft: CreateProductDraft, products: ProductRepository, stocks: StockRepository, clock, pool: Pool) =>
        new CreateProductWorkflow({ createDraft, products, stocks, runner: new PostgresTransactionRunner(pool), clock }),
      inject: [CreateProductDraft, TOKENS.ProductRepository, TOKENS.StockRepository, TOKENS.Clock, TOKENS.PgPool]
    },
    { provide: PublishProductWorkflow, useFactory: (stocks: StockRepository, publish: PublishProduct) => new PublishProductWorkflow({ stocks, publish }), inject: [TOKENS.StockRepository, PublishProduct] },
    { provide: AdminCatalogQueries, useFactory: (products: ProductRepository, stocks: StockRepository, urlBuilder: MediaUrlBuilder) => new AdminCatalogQueries({ products, stocks, urlBuilder }), inject: [TOKENS.ProductRepository, TOKENS.StockRepository, TOKENS.MediaUrlBuilder] },
    { provide: MiniCatalogQueries, useFactory: (products: ProductRepository, stocks: StockRepository, urlBuilder: MediaUrlBuilder) => new MiniCatalogQueries({ products, stocks, urlBuilder }), inject: [TOKENS.ProductRepository, TOKENS.StockRepository, TOKENS.MediaUrlBuilder] }
  ],
  exports: [CheckReadiness]
})
export class FoundationModule {}

function validateSalesAllocation(text: string, unit: string, allowed: readonly number[]): void {
  if (!isPositiveSaleAllocation(text, unit, allowed)) throw new ApplicationError('PRODUCT_NOT_PUBLISHABLE', '数量与份额配置会造成零分配，请调整商品配置');
}

function wxPayRuntime() {
  const c = readConfig();
  return {
    configured: Boolean(c.wxPayMchid && c.wxPayApiV3Key && c.wxPaySerialNo && c.wxPayPrivateKeyPath),
    mchid: c.wxPayMchid,
    appid: c.wxAppid,
    apiV3Key: c.wxPayApiV3Key,
    privateKeyPath: c.wxPayPrivateKeyPath,
    platformPublicKeyPath: c.wxPayPlatformPublicKeyPath,
    serialNo: c.wxPaySerialNo,
    notifyUrl: c.wxPayNotifyUrl,
    endpointBase: c.wxPayEndpointBase ?? undefined
  };
}
