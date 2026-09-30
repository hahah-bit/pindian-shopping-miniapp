import { ApplicationError } from '../../../shared/kernel';
import type { MediaRepository, MediaUrlBuilder } from './ports';

export interface MediaAssetAdminView {
  id: string;
  url: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: Date;
  referencedByProducts: number;
}

export class ListMediaAssets {
  constructor(private readonly deps: { repository: MediaRepository; urlBuilder: MediaUrlBuilder }) {}

  async execute(query: { page?: unknown; pageSize?: unknown }): Promise<{ items: MediaAssetAdminView[]; page: number; pageSize: number; total: number }> {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const { items, total, referenceCounts } = await this.deps.repository.listReady(page, pageSize);
    return {
      page,
      pageSize,
      total,
      items: items.map((asset) => ({
        id: asset.state.mediaId,
        url: this.deps.urlBuilder.build(asset.state.mediaId),
        format: asset.state.format,
        width: asset.state.width,
        height: asset.state.height,
        sizeBytes: asset.state.sizeBytes,
        createdAt: asset.state.createdAt,
        referencedByProducts: referenceCounts.get(asset.state.mediaId) ?? 0
      }))
    };
  }
}

export function normalizePage(input: unknown): number {
  const page = typeof input === 'string' ? Number(input) : input;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) return 1;
  return page;
}

export function normalizePageSize(input: unknown): number {
  const size = typeof input === 'string' ? Number(input) : input;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) return 10;
  return Math.min(size, 50);
}
