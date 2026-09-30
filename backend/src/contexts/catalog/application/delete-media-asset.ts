import { ApplicationError, type Clock } from '../../../shared/kernel';
import type { ImageStorage, MediaRepository } from './ports';

/**
 * 删除图片资源：仍被商品引用则拒绝；未引用先标记 deleted（条件更新），
 * 再删除文件；文件删除失败仅告警（孤儿文件可人工清理），元数据以数据库为准。
 */
export class DeleteMediaAsset {
  constructor(private readonly deps: { repository: MediaRepository; storage: ImageStorage; clock: Clock }) {}

  async execute(input: { mediaId: unknown }): Promise<{ deleted: true }> {
    const mediaId = typeof input.mediaId === 'string' ? input.mediaId : '';
    if (!mediaId) throw new ApplicationError('VALIDATION_FAILED', '缺少图片 ID');
    const asset = await this.deps.repository.findById(mediaId);
    if (!asset || !asset.isReady) throw new ApplicationError('NOT_FOUND', '图片不存在');
    const references = await this.deps.repository.countReferences(mediaId);
    if (references > 0) throw new ApplicationError('MEDIA_IN_USE', `图片仍被 ${references} 个商品引用，先移除关联再删除`);
    const marked = await this.deps.repository.markDeleted(mediaId, this.deps.clock.now());
    if (!marked) throw new ApplicationError('NOT_FOUND', '图片不存在');
    await this.deps.storage.delete(asset.state.storageKey).catch((error) => {
      console.error('[media] 物理文件删除失败（孤儿文件，人工清理）', asset.state.storageKey, error instanceof Error ? error.message : error);
    });
    return { deleted: true };
  }
}
