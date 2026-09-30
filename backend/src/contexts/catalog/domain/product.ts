import { ApplicationError } from '../../../shared/kernel';
import { Quantity } from './quantity';
import { normalizeShareUnits, type ShareUnits } from './share-option';
import { validateOriginalPriceFen } from './pricing';

export type ProductStatus = 'draft' | 'on_shelf' | 'off_shelf';

export interface ProductImageRef {
  mediaId: string;
  role: 'main' | 'detail';
  sortOrder: number;
}

export interface ProductState {
  productId: string;
  name: string;
  description: string;
  originalPriceFen: number;
  wholeQuantityText: string;
  wholeQuantityMilli: number;
  unit: string;
  allowedShareUnits: ShareUnits[];
  status: ProductStatus;
  images: ProductImageRef[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductInput {
  name: unknown;
  description?: unknown;
  originalPriceFen: unknown;
  wholeQuantity: unknown;
  unit: unknown;
  allowedShareUnits: unknown;
  mainImageId?: unknown;
  detailImageIds?: unknown;
}

export interface ProductCreation extends ProductInput {
  productId?: string;
  now: Date;
}

/** 商品聚合根。状态修改返回新实例；不变量见 T002 ddd.md §2.3。 */
export class Product {
  private constructor(readonly state: ProductState) {}

  static create(input: ProductCreation): Product {
    const now = input.now;
    const fields = validateEditableFields(input);
    const images = buildImageRefs(input.mainImageId, input.detailImageIds);
    return new Product({
      productId: input.productId ?? crypto.randomUUID(),
      ...fields,
      status: 'draft',
      images,
      createdAt: now,
      updatedAt: now
    });
  }

  static rehydrate(state: ProductState): Product {
    return new Product({ ...state, allowedShareUnits: [...state.allowedShareUnits], images: state.images.map((i) => ({ ...i })) });
  }

  update(input: ProductInput, now: Date): Product {
    const fields = validateEditableFields(input);
    const images = buildImageRefs(input.mainImageId, input.detailImageIds);
    return new Product({ ...this.state, ...fields, images, updatedAt: now });
  }

  get mainImage(): ProductImageRef | undefined {
    return this.state.images.find((image) => image.role === 'main');
  }

  get detailImages(): ProductImageRef[] {
    return this.state.images.filter((image) => image.role === 'detail').sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * 上架条件清单（库存事实由 Inventory 提供，null 表示无库存记录）。
   * 返回空数组表示可上架。
   */
  publishEligibilityReasons(stockAvailableWholeItems: number | null): string[] {
    const reasons: string[] = [];
    try {
      validateEditableFields({
        name: this.state.name,
        description: this.state.description,
        originalPriceFen: this.state.originalPriceFen,
        wholeQuantity: this.state.wholeQuantityText,
        unit: this.state.unit,
        allowedShareUnits: this.state.allowedShareUnits
      });
    } catch {
      reasons.push('商品资料不完整，请先补全必填项');
    }
    if (!this.mainImage) reasons.push('未设置主图');
    if (stockAvailableWholeItems === null) reasons.push('库存记录不存在');
    else if (stockAvailableWholeItems <= 0) reasons.push('库存为 0，补充库存后才能上架');
    return reasons;
  }

  publish(stockAvailableWholeItems: number | null, now: Date): Product {
    if (this.state.status === 'on_shelf') return this;
    const reasons = this.publishEligibilityReasons(stockAvailableWholeItems);
    if (reasons.length > 0) {
      throw new ApplicationError('PRODUCT_NOT_PUBLISHABLE', '商品暂不满足上架条件', reasons);
    }
    return new Product({ ...this.state, status: 'on_shelf', updatedAt: now });
  }

  unpublish(now: Date): Product {
    if (this.state.status !== 'on_shelf') return this;
    return new Product({ ...this.state, status: 'off_shelf', updatedAt: now });
  }
}

interface EditableFields {
  name: string;
  description: string;
  originalPriceFen: number;
  wholeQuantityText: string;
  wholeQuantityMilli: number;
  unit: string;
  allowedShareUnits: ShareUnits[];
}

function validateEditableFields(input: ProductInput): EditableFields {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 60) throw new ApplicationError('VALIDATION_FAILED', '商品名称须为 1-60 个字符');
  const description = typeof input.description === 'string' ? input.description : '';
  if (description.length > 2000) throw new ApplicationError('VALIDATION_FAILED', '商品介绍不能超过 2000 字符');
  const originalPriceFen = validateOriginalPriceFen(input.originalPriceFen);
  const quantity = Quantity.parse(input.wholeQuantity);
  const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
  if (unit.length < 1 || unit.length > 10) throw new ApplicationError('VALIDATION_FAILED', '计量单位须为 1-10 个字符');
  const allowedShareUnits = normalizeShareUnits(input.allowedShareUnits);
  return {
    name,
    description,
    originalPriceFen,
    wholeQuantityText: quantity.text,
    wholeQuantityMilli: quantity.milli,
    unit,
    allowedShareUnits
  };
}

function buildImageRefs(mainImageId: unknown, detailImageIds: unknown): ProductImageRef[] {
  const main = normalizeOptionalId(mainImageId);
  const details = normalizeDetailIds(detailImageIds);
  if (main && details.includes(main)) {
    throw new ApplicationError('VALIDATION_FAILED', '主图与详情图不能引用同一张图片');
  }
  const images: ProductImageRef[] = [];
  if (main) images.push({ mediaId: main, role: 'main', sortOrder: 0 });
  details.forEach((mediaId, index) => images.push({ mediaId, role: 'detail', sortOrder: index + 1 }));
  return images;
}

function normalizeOptionalId(input: unknown): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
    throw new ApplicationError('VALIDATION_FAILED', '图片 ID 格式无效');
  }
  return input;
}

function normalizeDetailIds(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new ApplicationError('VALIDATION_FAILED', '详情图列表格式无效');
  if (input.length > 9) throw new ApplicationError('VALIDATION_FAILED', '详情图最多 9 张');
  const ids = input.map((value) => {
    const id = normalizeOptionalId(value);
    if (!id) throw new ApplicationError('VALIDATION_FAILED', '详情图 ID 不能为空');
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new ApplicationError('VALIDATION_FAILED', '详情图不能重复引用同一张图片');
  return ids;
}
