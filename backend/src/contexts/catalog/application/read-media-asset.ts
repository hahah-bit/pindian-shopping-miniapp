import { ApplicationError } from '../../../shared/kernel';
import type { MediaFormat } from '../domain/media-asset';
import { contentTypeFor } from './image-inspector';
import type { ImageStorage, MediaRepository } from './ports';
import type { Readable } from 'node:stream';

export interface OpenedMedia {
  stream: Readable;
  contentType: string;
  size: number;
}

/** 公开读取图片：仅 ready 资源；经存储端口流式返回。 */
export class ReadMediaAsset {
  constructor(private readonly deps: { repository: MediaRepository; storage: ImageStorage }) {}

  async execute(mediaId: unknown): Promise<OpenedMedia> {
    if (typeof mediaId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mediaId)) {
      throw new ApplicationError('NOT_FOUND', '图片不存在');
    }
    const asset = await this.deps.repository.findById(mediaId);
    if (!asset || !asset.isReady) throw new ApplicationError('NOT_FOUND', '图片不存在');
    const opened = await this.deps.storage.open(asset.state.storageKey);
    return { stream: opened.stream, contentType: contentTypeFor(asset.state.format as MediaFormat), size: opened.size };
  }
}
