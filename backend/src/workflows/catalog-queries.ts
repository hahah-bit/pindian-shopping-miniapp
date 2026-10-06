import { normalizeCategory } from '../contexts/catalog/domain/product';
import { ApplicationError } from '../shared/kernel';
import { formatMilli, referenceSharePriceFen, shareLabel, shareQuantityMilli, type Product, type ShareUnits } from '../contexts/catalog/domain';
import type { MediaUrlBuilder, ProductRepository, ListAdminQuery } from '../contexts/catalog/application/ports';
import { normalizePage, normalizePageSize } from '../contexts/catalog/application/list-media-assets';
import type { StockRepository } from '../contexts/inventory/application/ports';

function shareOptionsOf(product: Product): { units: ShareUnits; fractionLabel: string; quantityText: string; referencePriceFen: number }[] {
  return product.state.allowedShareUnits.map((units) => ({
    units,
    fractionLabel: shareLabel(units),
    quantityText: formatMilli(shareQuantityMilli(product.state.wholeQuantityMilli, units)),
    referencePriceFen: referenceSharePriceFen(product.state.originalPriceFen, units)
  }));
}

interface StockFact {
  productId: string;
  availableWholeItems: number;
  reservedWholeItems: number;
  updatedAt: Date;
}

/** 后台商品查询装配（Catalog 商品 + Inventory 库存 + 媒体 URL）。 */
export class AdminCatalogQueries {
  constructor(private readonly deps: { products: ProductRepository; stocks: Pick<StockRepository, 'findById'>; urlBuilder: MediaUrlBuilder }) {}

  private async stockOf(productId: string): Promise<StockFact | null> {
    const stock = await this.deps.stocks.findById(productId);
    return stock ? { productId: stock.state.productId, availableWholeItems: stock.state.availableWholeItems, reservedWholeItems: stock.state.reservedWholeItems, updatedAt: stock.state.updatedAt } : null;
  }

  async list(rawQuery: { status?: unknown; keyword?: unknown; page?: unknown; pageSize?: unknown }) {
    const page = normalizePage(rawQuery.page);
    const pageSize = normalizePageSize(rawQuery.pageSize);
    const status = typeof rawQuery.status === 'string' && ['draft', 'on_shelf', 'off_shelf'].includes(rawQuery.status) ? rawQuery.status : undefined;
    const keyword = typeof rawQuery.keyword === 'string' && rawQuery.keyword.trim() ? rawQuery.keyword.trim() : undefined;
    const query: ListAdminQuery = { status, keyword, page, pageSize };
    const { items, total } = await this.deps.products.listAdmin(query);
    const rows = await Promise.all(items.map(async (product) => {
      const stock = await this.stockOf(product.state.productId);
      return {
        id: product.state.productId,
        name: product.state.name,
        category: product.state.category ?? 'other',
        originalPriceFen: product.state.originalPriceFen,
        wholeQuantity: product.state.wholeQuantityText,
        unit: product.state.unit,
        status: product.state.status,
        stockStatus: (stock?.availableWholeItems ?? 0) > 0 ? 'available' : 'sold_out',
        availableWholeItems: stock?.availableWholeItems ?? 0,
        mainImageUrl: product.mainImage ? this.deps.urlBuilder.build(product.mainImage.mediaId) : undefined,
        createdAt: product.state.createdAt
      };
    }));
    return { items: rows, page, pageSize, total };
  }

  async get(productId: unknown) {
    if (typeof productId !== 'string') throw new ApplicationError('VALIDATION_FAILED', '商品 ID 格式无效');
    const product = await this.deps.products.findById(productId);
    if (!product) throw new ApplicationError('NOT_FOUND', '商品不存在');
    const stock = await this.stockOf(productId);
    const available = stock?.availableWholeItems ?? 0;
    return {
      id: product.state.productId,
      name: product.state.name,
        category: product.state.category ?? 'other',
      description: product.state.description,
      originalPriceFen: product.state.originalPriceFen,
      userWholePriceFen: product.state.originalPriceFen + 500,
      wholeQuantity: product.state.wholeQuantityText,
      unit: product.state.unit,
      allowedShareUnits: product.state.allowedShareUnits,
      shareOptions: shareOptionsOf(product),
      status: product.state.status,
      stockStatus: available > 0 ? 'available' : 'sold_out',
      availableWholeItems: available,
      mainImage: product.mainImage
        ? { mediaId: product.mainImage.mediaId, url: this.deps.urlBuilder.build(product.mainImage.mediaId), role: 'main' as const, sortOrder: 0 }
        : undefined,
      detailImages: product.detailImages.map((image) => ({ mediaId: image.mediaId, url: this.deps.urlBuilder.build(image.mediaId), role: 'detail' as const, sortOrder: image.sortOrder })),
      createdAt: product.state.createdAt,
      updatedAt: product.state.updatedAt
    };
  }
}

/** 小程序商品查询装配：仅上架商品；不暴露后台字段。 */
export class MiniCatalogQueries {
  constructor(private readonly deps: { products: ProductRepository; stocks: Pick<StockRepository, 'findById'>; urlBuilder: MediaUrlBuilder }) {}

  private async stockAvailable(productId: string): Promise<number> {
    const stock = await this.deps.stocks.findById(productId);
    return stock?.state.availableWholeItems ?? 0;
  }

  async list(rawQuery: { page?: unknown; pageSize?: unknown; keyword?: unknown; category?: unknown }) {
    const page = normalizePage(rawQuery.page);
    const pageSize = normalizePageSize(rawQuery.pageSize);
    if (rawQuery.keyword !== undefined && (typeof rawQuery.keyword !== 'string' || rawQuery.keyword.trim().length > 60)) throw new ApplicationError('VALIDATION_FAILED', '搜索词最多60个字符');
    const keyword = typeof rawQuery.keyword === 'string' ? rawQuery.keyword.trim() || undefined : undefined;
    const category = rawQuery.category === undefined || rawQuery.category === '' ? undefined : normalizeCategory(rawQuery.category);
    const { items, total } = await this.deps.products.listOnShelf({ page, pageSize, keyword, category });
    const rows = await Promise.all(items.map(async (product) => {
      const available = await this.stockAvailable(product.state.productId);
      const options = shareOptionsOf(product);
      return {
        id: product.state.productId,
        name: product.state.name,
        category: product.state.category ?? 'other',
        mainImageUrl: product.mainImage ? this.deps.urlBuilder.build(product.mainImage.mediaId) : undefined,
        originalPriceFen: product.state.originalPriceFen,
        userWholePriceFen: product.state.originalPriceFen + 500,
        priceFromFen: Math.min(...options.map((option) => option.referencePriceFen)),
        stockStatus: available > 0 ? 'available' : 'sold_out'
      };
    }));
    return { items: rows, page, pageSize, total };
  }

  async get(productId: unknown) {
    if (typeof productId !== 'string') throw new ApplicationError('VALIDATION_FAILED', '商品 ID 格式无效');
    const product = await this.deps.products.findByIdIfOnShelf(productId);
    if (!product) throw new ApplicationError('NOT_FOUND', '商品不存在或已下架');
    const available = await this.stockAvailable(productId);
    const options = shareOptionsOf(product);
    return {
      id: product.state.productId,
      name: product.state.name,
        category: product.state.category ?? 'other',
      description: product.state.description.replace(/\n?\[demo-catalog-v1:[a-z0-9-]+\]/g, '').trim(),
      mainImageUrl: product.mainImage ? this.deps.urlBuilder.build(product.mainImage.mediaId) : undefined,
      detailImageUrls: product.detailImages.map((image) => this.deps.urlBuilder.build(image.mediaId)),
      originalPriceFen: product.state.originalPriceFen,
      userWholePriceFen: product.state.originalPriceFen + 500,
      priceFromFen: Math.min(...options.map((option) => option.referencePriceFen)),
      wholeQuantity: product.state.wholeQuantityText,
      unit: product.state.unit,
      shareOptions: options,
      stockStatus: available > 0 ? 'available' : 'sold_out'
    };
  }
}
