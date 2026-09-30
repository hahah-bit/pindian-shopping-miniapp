import { createHash } from 'node:crypto';
import { ApplicationError, type Clock } from '../../../shared/kernel';
import { MediaAsset, buildStorageKey } from '../domain/media-asset';
import { ImageInspector } from './image-inspector';
import type { ImageStorage, MediaRepository, MediaUrlBuilder } from './ports';

export interface UploadMediaResult {
  id: string;
  storageKey: string;
  url: string;
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface UploadMediaDeps {
  storage: ImageStorage;
  repository: MediaRepository;
  urlBuilder: MediaUrlBuilder;
  inspector: ImageInspector;
  clock: Clock;
}

/**
 * 上传图片：校验 → 写存储 → 落库；落库失败补偿删除文件，
 * 保证不返回可引用的无效资源（T002 spec G5）。
 */
export class UploadMediaAsset {
  constructor(private readonly deps: UploadMediaDeps) {}

  async execute(input: { buffer: Buffer | undefined; uploadedBy: string | null }): Promise<UploadMediaResult> {
    const buffer = input.buffer;
    if (!buffer || buffer.length === 0) throw new ApplicationError('VALIDATION_FAILED', '未接收到文件内容');
    const inspected = this.deps.inspector.inspect(buffer);
    const now = this.deps.clock.now();
    const storageKey = buildStorageKey(inspected.format, now);
    const asset = MediaAsset.create({
      storageKey,
      format: inspected.format,
      sizeBytes: buffer.length,
      width: inspected.width,
      height: inspected.height,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      uploadedBy: input.uploadedBy,
      createdAt: now
    });

    try {
      await this.deps.storage.put(storageKey, buffer);
    } catch (error) {
      console.error('[media] 存储写入失败', error instanceof Error ? error.message : error);
      throw new ApplicationError('STORAGE_UNAVAILABLE', '图片存储暂不可用，请稍后重试');
    }

    try {
      await this.deps.repository.insert(asset);
    } catch (error) {
      await this.deps.storage.delete(storageKey).catch((deleteError) => {
        console.error('[media] 补偿删除失败，存在孤儿文件', storageKey, deleteError instanceof Error ? deleteError.message : deleteError);
      });
      console.error('[media] 元数据落库失败', error instanceof Error ? error.message : error);
      throw new ApplicationError('MEDIA_SAVE_FAILED', '图片保存失败，请稍后重试');
    }

    return {
      id: asset.state.mediaId,
      storageKey,
      url: this.deps.urlBuilder.build(asset.state.mediaId),
      format: asset.state.format,
      width: asset.state.width,
      height: asset.state.height,
      sizeBytes: asset.state.sizeBytes
    };
  }
}
