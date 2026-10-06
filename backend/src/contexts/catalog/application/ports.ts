import type { Readable } from 'node:stream';
import type { MediaAsset } from '../domain/media-asset';
import type { Product } from '../domain/product';

/** 图片文件存储出站端口：开发阶段为本地文件适配器（Docker 命名卷），保留对象存储接入边界。 */
export interface ImageStorage {
  put(key: string, data: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
  open(key: string): Promise<{ stream: Readable; size: number }>;
}

export interface MediaRepository {
  insert(asset: MediaAsset): Promise<void>;
  findById(mediaId: string): Promise<MediaAsset | null>;
  /** 校验商品引用的图片全部存在且 ready。 */
  findManyReady(mediaIds: string[]): Promise<MediaAsset[]>;
  listReady(page: number, pageSize: number): Promise<{ items: MediaAsset[]; total: number; referenceCounts: Map<string, number> }>;
  countReferences(mediaId: string): Promise<number>;
  /** 条件删除标记：仅 status=ready 时成功；竞态失败返回 false。 */
  markDeleted(mediaId: string, now: Date): Promise<boolean>;
}

/** 访问 URL 生成端口：按环境（PUBLIC_API_BASE_URL）生成公开地址，不落库。 */
export interface MediaUrlBuilder {
  build(mediaId: string): string;
}

export interface ListAdminQuery {
  status?: string | null;
  keyword?: string | null;
  page: number;
  pageSize: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export interface ProductRepository {
  /** 保存聚合（含图片关联全量替换）；可传入事务会话。 */
  save(product: Product, session?: unknown): Promise<void>;
  findById(productId: string): Promise<Product | null>;
  listAdmin(query: ListAdminQuery): Promise<PageResult<Product>>;
  listOnShelf(query: { page: number; pageSize: number; keyword?: string; category?: string }): Promise<PageResult<Product>>;
  findByIdIfOnShelf(productId: string): Promise<Product | null>;
}
