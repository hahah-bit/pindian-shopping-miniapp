import { MediaAsset, type MediaAssetState } from '../../../domain/media-asset';
import type { MediaRepository } from '../../../application/ports';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface MediaRow {
  id: string;
  storage_key: string;
  format: MediaAssetState['format'];
  size_bytes: number;
  width: number;
  height: number;
  sha256: string;
  status: MediaAssetState['status'];
  uploaded_by: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

function toDomain(row: MediaRow): MediaAsset {
  return new MediaAsset({
    mediaId: row.id,
    storageKey: row.storage_key,
    format: row.format,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    status: row.status,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    deletedAt: row.deleted_at
  });
}

export class PostgresMediaRepository implements MediaRepository {
  constructor(private readonly pool: PgExecutor) {}

  async insert(asset: MediaAsset): Promise<void> {
    const s = asset.state;
    await withExecutor(this.pool, (client) => client.query(
      `INSERT INTO media_assets (id, storage_key, format, size_bytes, width, height, sha256, status, uploaded_by, created_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [s.mediaId, s.storageKey, s.format, s.sizeBytes, s.width, s.height, s.sha256, s.status, s.uploadedBy, s.createdAt, s.deletedAt]
    ));
  }

  async findById(mediaId: string): Promise<MediaAsset | null> {
    return withExecutor(this.pool, async (client) => {
      const { rows } = await client.query<MediaRow>('SELECT * FROM media_assets WHERE id = $1', [mediaId]);
      return rows[0] ? toDomain(rows[0]) : null;
    });
  }

  async findManyReady(mediaIds: string[]): Promise<MediaAsset[]> {
    if (mediaIds.length === 0) return [];
    return withExecutor(this.pool, async (client) => {
      const { rows } = await client.query<MediaRow>(
        `SELECT * FROM media_assets WHERE id = ANY($1::uuid[]) AND status = 'ready'`,
        [mediaIds]
      );
      return rows.map(toDomain);
    });
  }

  async listReady(page: number, pageSize: number): Promise<{ items: MediaAsset[]; total: number; referenceCounts: Map<string, number> }> {
    return withExecutor(this.pool, async (client) => {
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM media_assets WHERE status = 'ready'`);
      const { rows } = await client.query<MediaRow & { reference_count: string }>(
        `SELECT m.*, (
           SELECT COUNT(*)::int4 FROM product_images pi WHERE pi.media_asset_id = m.id
         ) AS reference_count
         FROM media_assets m WHERE m.status = 'ready'
         ORDER BY m.created_at DESC, m.id DESC LIMIT $1 OFFSET $2`,
        [pageSize, (page - 1) * pageSize]
      );
      const referenceCounts = new Map<string, number>(rows.map((row) => [row.id, Number(row.reference_count)]));
      return { items: rows.map(toDomain), total: Number(countRows[0]?.total ?? 0), referenceCounts };
    });
  }

  async countReferences(mediaId: string): Promise<number> {
    return withExecutor(this.pool, async (client) => {
      const { rows } = await client.query<{ count: string }>('SELECT COUNT(*)::int4 AS count FROM product_images WHERE media_asset_id = $1', [mediaId]);
      return Number(rows[0]?.count ?? 0);
    });
  }

  async markDeleted(mediaId: string, now: Date): Promise<boolean> {
    return withExecutor(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE media_assets SET status = 'deleted', deleted_at = $2
         WHERE id = $1 AND status = 'ready'
           AND NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.media_asset_id = $1)`,
        [mediaId, now]
      );
      return (result.rowCount ?? 0) > 0;
    });
  }
}
