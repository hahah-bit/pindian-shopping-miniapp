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
import { CreateFullRefundUseCase, CancelPaidOrderWorkflow, RetryRefund } from '../contexts/payments/application/refund-flow';
import { MiniRefundQueries } from '../contexts/payments/application/mini-refund-views';
import { AdminPayRefundQueries } from '../contexts/payments/application/admin-pay-refund-queries';
import { contexts } from './context-registry';
import { readConfig } from './config';
import type { RuntimeConfig } from './config';
import { TOKENS } from './injection-tokens';

/** 装配层：绑定端口实现与用例；领域与应用不感知 DI。 */
@Module({
  controllers: [
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
    AdminPayRefundController
  ],
  providers: [
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
    { provide: UpdateProduct, useFactory: (products: ProductRepository, media: MediaRepository, clock) => new UpdateProduct({ products, media, clock }), inject: [TOKENS.ProductRepository, TOKENS.MediaRepository, TOKENS.Clock] },
    { provide: PublishProduct, useFactory: (products: ProductRepository, clock) => new PublishProduct({ products, clock }), inject: [TOKENS.ProductRepository, TOKENS.Clock] },
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
    { provide: PaymentQueryResult, useFactory: (payments, orders, payConfig) => new PaymentQueryResult({ payments, orders, payConfig }), inject: ['PAYMENT_REPOSITORY', 'ORDER_REPOSITORY', 'PAY_CONFIG'] },
    { provide: 'NOTIFY_VERIFIER', useFactory: () => new WxPayNotifyVerifier({ configured: wxPayRuntime().configured, apiV3Key: wxPayRuntime().apiV3Key, mchid: wxPayRuntime().mchid }) },
    {
      provide: 'NOTIFY_APPLIER',
      useFactory: (payments, groups, reservations, orders, stocks, refunds, pool: Pool, clock) => {
        const confirm = new ConfirmPaymentWorkflow({ groups, reservations, orders, payments, refunds: { createFullRefund: (i) => refunds.execute(i) }, stocks, runner: new PostgresTransactionRunner(pool), clock });
        return { apply: async (fact: { outTradeNo: string; channelTransactionId: string; payerTotal: number; payload: Record<string, unknown> }) => confirm.execute({ channelFact: fact, source: 'callback' }) };
      },
      inject: ['PAYMENT_REPOSITORY', 'GROUP_REPOSITORY', 'SHARE_RESERVATION_REPOSITORY', 'ORDER_REPOSITORY', 'STOCK_RESERVATION_PORT', 'REFUND_CREATOR', TOKENS.PgPool, TOKENS.Clock]
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

function wxPayRuntime() {
  const c = readConfig();
  return {
    configured: Boolean(c.wxPayMchid && c.wxPayApiV3Key && c.wxPaySerialNo && c.wxPayPrivateKeyPath),
    mchid: c.wxPayMchid,
    appid: c.wxAppid,
    apiV3Key: c.wxPayApiV3Key,
    privateKeyPath: c.wxPayPrivateKeyPath,
    serialNo: c.wxPaySerialNo,
    notifyUrl: c.wxPayNotifyUrl,
    endpointBase: c.wxPayEndpointBase ?? undefined
  };
}
