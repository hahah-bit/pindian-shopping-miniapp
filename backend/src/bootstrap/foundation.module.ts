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
import { AdminAuthGuard } from '../contexts/identity-access/adapters/inbound/admin/admin-auth.guard';
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
import { contexts } from './context-registry';
import { readConfig } from './config';
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
    AdminStockController
  ],
  providers: [
    { provide: TOKENS.PgPool, useFactory: () => new Pool({ connectionString: readConfig().databaseUrl, max: 10 }) },
    { provide: TOKENS.Clock, useFactory: () => new SystemClock() },
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
    { provide: AdminAuthGuard, useFactory: (reflector: Reflector, authenticate: AuthenticateAdmin) => new AdminAuthGuard(reflector, authenticate), inject: [Reflector, AuthenticateAdmin] },
    { provide: APP_GUARD, useExisting: AdminAuthGuard },
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
