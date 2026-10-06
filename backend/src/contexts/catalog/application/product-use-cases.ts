import { ApplicationError, SystemClock, type Clock } from '../../../shared/kernel';
import { Product, type ProductInput } from '../domain/product';
import type { MediaRepository, ProductRepository } from './ports';

/** 创建草稿（不落库）：字段校验 + 引用图片必须存在且 ready。供工作流在同事务中保存。 */
export class CreateProductDraft {
  private readonly clock: Clock;
  constructor(private readonly deps: { media: MediaRepository; clock?: Clock }) {
    this.clock = deps.clock ?? new SystemClock();
  }

  async execute(rawInput: Record<string, unknown> | ProductInput): Promise<Product> {
    const input = rawInput as ProductInput;
    const mainImageId = normalizeOptionalMediaId(input.mainImageId);
    const detailImageIds = normalizeMediaIdList(input.detailImageIds);
    const referenced = [mainImageId, ...detailImageIds].filter((id): id is string => Boolean(id));
    if (referenced.length > 0) {
      const ready = new Set((await this.deps.media.findManyReady(referenced)).map((asset) => asset.state.mediaId));
      const missing = referenced.filter((id) => !ready.has(id));
      if (missing.length > 0) {
        throw new ApplicationError('VALIDATION_FAILED', '引用的图片不存在或不可用，请重新上传');
      }
    }
    return Product.create({ ...input, mainImageId, detailImageIds, now: this.clock.now() });
  }
}

function normalizeOptionalMediaId(input: unknown): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string') throw new ApplicationError('VALIDATION_FAILED', '主图 ID 格式无效');
  return input;
}

function normalizeMediaIdList(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.some((id) => typeof id !== 'string')) {
    throw new ApplicationError('VALIDATION_FAILED', '详情图列表格式无效');
  }
  return input as string[];
}

/** 编辑商品：字段与图片关联全量替换。 */
export class UpdateProduct {
  private readonly clock: Clock;
  constructor(private readonly deps: { products: ProductRepository; media: MediaRepository; clock?: Clock; validateAllocation?: (text: string, unit: string, allowed: readonly number[]) => void }) {
    this.clock = deps.clock ?? new SystemClock();
  }

  async execute(input: { productId: unknown; input: Record<string, unknown> | ProductInput }): Promise<Product> {
    const productId = requireProductId(input.productId);
    const existing = await this.deps.products.findById(productId);
    if (!existing) throw new ApplicationError('NOT_FOUND', '商品不存在');
    const draft = new CreateProductDraft({ media: this.deps.media });
    const validatedMedia = await draft.execute(input.input);
    const updated = existing.update(
      {
        name: validatedMedia.state.name,
        category: input.input.category === undefined ? existing.state.category : validatedMedia.state.category,
        description: validatedMedia.state.description,
        originalPriceFen: validatedMedia.state.originalPriceFen,
        wholeQuantity: validatedMedia.state.wholeQuantityText,
        unit: validatedMedia.state.unit,
        allowedShareUnits: validatedMedia.state.allowedShareUnits,
        mainImageId: validatedMedia.mainImage?.mediaId,
        detailImageIds: validatedMedia.detailImages.map((image) => image.mediaId)
      },
      this.clock.now()
    );
    if (updated.state.status === 'on_shelf') this.deps.validateAllocation?.(updated.state.wholeQuantityText, updated.state.unit, updated.state.allowedShareUnits);
    await this.deps.products.save(updated);
    return updated;
  }
}

/** 上架：库存事实（available 或 null）由工作流传入；幂等。 */
export class PublishProduct {
  private readonly clock: Clock;
  constructor(private readonly deps: { products: ProductRepository; clock?: Clock; validateAllocation?: (text: string, unit: string, allowed: readonly number[]) => void }) {
    this.products = deps.products;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly products: ProductRepository;

  async execute(input: { productId: unknown; stockAvailableWholeItems: number | null }): Promise<Product> {
    const productId = requireProductId(input.productId);
    const existing = await this.products.findById(productId);
    if (!existing) throw new ApplicationError('NOT_FOUND', '商品不存在');
    this.deps.validateAllocation?.(existing.state.wholeQuantityText, existing.state.unit, existing.state.allowedShareUnits);
    const published = existing.publish(input.stockAvailableWholeItems, this.clock.now());
    if (published !== existing) await this.products.save(published);
    return published;
  }
}

/** 下架：幂等。 */
export class UnpublishProduct {
  private readonly clock: Clock;
  constructor(deps: { products: ProductRepository; clock?: Clock }) {
    this.products = deps.products;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly products: ProductRepository;

  async execute(input: { productId: unknown }): Promise<Product> {
    const productId = requireProductId(input.productId);
    const existing = await this.products.findById(productId);
    if (!existing) throw new ApplicationError('NOT_FOUND', '商品不存在');
    const updated = existing.unpublish(this.clock.now());
    if (updated !== existing) await this.products.save(updated);
    return updated;
  }
}

export function requireProductId(input: unknown): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    throw new ApplicationError('VALIDATION_FAILED', '商品 ID 格式无效');
  }
  return input;
}
