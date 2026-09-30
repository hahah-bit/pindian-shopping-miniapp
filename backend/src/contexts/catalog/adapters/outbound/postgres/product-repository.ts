import { Product, type ProductImageRef, type ProductState } from '../../../domain/product';
import type { ListAdminQuery, PageResult, ProductRepository } from '../../../application/ports';
import { isPoolClient, withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface ProductRow {
  id: string;
  name: string;
  description: string;
  original_price_fen: number;
  whole_quantity: string;
  unit: string;
  allowed_share_units: number[];
  status: ProductState['status'];
  created_at: Date;
  updated_at: Date;
}

interface ImageRow {
  media_asset_id: string;
  role: 'main' | 'detail';
  sort_order: number;
}

/** 数量字符串 → 毫单位整数；避免浮点误差（如 0.001×1000）。 */
function quantityMilli(text: string): number {
  const [intPart, decimalPart = ''] = text.split('.');
  return Number(intPart) * 1000 + Number(decimalPart.padEnd(3, '0'));
}

/** pg numeric 返回 "10.000"，展示统一修剪尾零为 "10"。 */
function normalizeQuantityText(text: string): string {
  const [intPart = '0', decimalPart] = text.split('.');
  if (decimalPart === undefined) return intPart;
  const trimmed = decimalPart.replace(/0+$/, '');
  return trimmed ? `${intPart}.${trimmed}` : intPart;
}

function toDomain(row: ProductRow, images: ImageRow[]): Product {
  return Product.rehydrate({
    productId: row.id,
    name: row.name,
    description: row.description,
    originalPriceFen: row.original_price_fen,
    wholeQuantityText: normalizeQuantityText(row.whole_quantity),
    wholeQuantityMilli: quantityMilli(row.whole_quantity),
    unit: row.unit,
    allowedShareUnits: row.allowed_share_units as ProductState['allowedShareUnits'],
    status: row.status,
    images: images.map((image) => ({ mediaId: image.media_asset_id, role: image.role, sortOrder: image.sort_order })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export class PostgresProductRepository implements ProductRepository {
  constructor(private readonly pool: PgExecutor) {}

  async save(product: Product, session?: unknown): Promise<void> {
    const state = product.state;
    await withExecutor((session as PgExecutor) ?? this.pool, async (client) => {
      const own = !isPoolClient(session);
      if (own) await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO products (id, name, description, original_price_fen, whole_quantity, unit, allowed_share_units, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             original_price_fen = EXCLUDED.original_price_fen,
             whole_quantity = EXCLUDED.whole_quantity,
             unit = EXCLUDED.unit,
             allowed_share_units = EXCLUDED.allowed_share_units,
             status = EXCLUDED.status,
             updated_at = EXCLUDED.updated_at`,
          [state.productId, state.name, state.description, state.originalPriceFen, state.wholeQuantityText, state.unit, state.allowedShareUnits, state.status, state.createdAt, state.updatedAt]
        );
        await client.query('DELETE FROM product_images WHERE product_id = $1', [state.productId]);
        for (const image of state.images) {
          await client.query(
            'INSERT INTO product_images (product_id, media_asset_id, role, sort_order) VALUES ($1,$2,$3,$4)',
            [state.productId, image.mediaId, image.role, image.sortOrder]
          );
        }
        if (own) await client.query('COMMIT');
      } catch (error) {
        if (own) await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  private async loadOne(executor: PgExecutor, productId: string): Promise<Product | null> {
    return withExecutor(executor, async (client) => {
      const { rows } = await client.query<ProductRow & { images: ImageRow[] }>(
        `SELECT p.*, COALESCE(
           (SELECT json_agg(json_build_object('media_asset_id', pi.media_asset_id, 'role', pi.role, 'sort_order', pi.sort_order) ORDER BY pi.sort_order)
            FROM product_images pi WHERE pi.product_id = p.id), '[]'::json) AS images
         FROM products p WHERE p.id = $1`,
        [productId]
      );
      const row = rows[0];
      return row ? toDomain(row, row.images as ImageRow[]) : null;
    });
  }

  async findById(productId: string): Promise<Product | null> {
    return this.loadOne(this.pool, productId);
  }

  async findByIdIfOnShelf(productId: string): Promise<Product | null> {
    const product = await this.findById(productId);
    return product && product.state.status === 'on_shelf' ? product : null;
  }

  async listAdmin(query: ListAdminQuery): Promise<PageResult<Product>> {
    return withExecutor(this.pool, async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.status && ['draft', 'on_shelf', 'off_shelf'].includes(query.status)) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      if (query.keyword) {
        params.push(`%${query.keyword}%`);
        conditions.push(`name ILIKE $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM products ${where}`, params);
      const offset = (query.page - 1) * query.pageSize;
      const { rows } = await client.query<ProductRow & { images: ImageRow[] }>(
        `SELECT p.*, COALESCE((
           SELECT json_agg(json_build_object('media_asset_id', pi.media_asset_id, 'role', pi.role, 'sort_order', pi.sort_order) ORDER BY pi.sort_order)
           FROM product_images pi WHERE pi.product_id = p.id), '[]'::json) AS images
         FROM products p ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, offset]
      );
      return { items: rows.map((row) => toDomain(row, row.images as ImageRow[])), total: Number(countRows[0]?.total ?? 0) };
    });
  }

  async listOnShelf(query: { page: number; pageSize: number }): Promise<PageResult<Product>> {
    return withExecutor(this.pool, async (client) => {
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM products WHERE status = 'on_shelf'`);
      const { rows } = await client.query<ProductRow & { images: ImageRow[] }>(
        `SELECT p.*, COALESCE((
           SELECT json_agg(json_build_object('media_asset_id', pi.media_asset_id, 'role', pi.role, 'sort_order', pi.sort_order) ORDER BY pi.sort_order)
           FROM product_images pi WHERE pi.product_id = p.id), '[]'::json) AS images
         FROM products p WHERE p.status = 'on_shelf' ORDER BY p.created_at DESC, p.id DESC LIMIT $1 OFFSET $2`,
        [query.pageSize, (query.page - 1) * query.pageSize]
      );
      return { items: rows.map((row) => toDomain(row, row.images as ImageRow[])), total: Number(countRows[0]?.total ?? 0) };
    });
  }
}

