import { ApplicationError } from '../../../shared/kernel';

export type MediaFormat = 'jpeg' | 'png' | 'webp';
export type MediaAssetStatus = 'ready' | 'deleted';

export const MEDIA_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  minWidth: 60,
  maxWidth: 6000,
  minHeight: 60,
  maxHeight: 6000
} as const;

export const FORMAT_EXTENSIONS: Record<MediaFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

export interface MediaAssetState {
  mediaId: string;
  storageKey: string;
  format: MediaFormat;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  status: MediaAssetStatus;
  uploadedBy: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface CreateMediaAssetInput {
  mediaId?: string;
  storageKey: string;
  format: MediaFormat;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  uploadedBy: string | null;
  createdAt: Date;
}

/** 图片资源聚合根：不可变文件事实；仅允许 ready → deleted 一次迁移（且要求无引用，由用例保证）。 */
export class MediaAsset {
  readonly state: MediaAssetState;

  /** 校验并创建 ready 资源（mediaId 服务端生成）。 */
  static create(input: CreateMediaAssetInput): MediaAsset {
    return new MediaAsset({
      mediaId: input.mediaId ?? crypto.randomUUID(),
      storageKey: input.storageKey,
      format: input.format,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      status: 'ready',
      uploadedBy: input.uploadedBy,
      createdAt: input.createdAt,
      deletedAt: null
    });
  }

  constructor(state: MediaAssetState) {
    if (!state.storageKey || !/^products\/\d{4}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(state.storageKey)) {
      throw new ApplicationError('VALIDATION_FAILED', '存储标识格式无效');
    }
    if (!Number.isInteger(state.sizeBytes) || state.sizeBytes < 1 || state.sizeBytes > MEDIA_LIMITS.maxBytes) {
      throw new ApplicationError('VALIDATION_FAILED', `图片大小须为 1-${MEDIA_LIMITS.maxBytes} 字节`);
    }
    for (const [label, value, min, max] of [['宽', state.width, MEDIA_LIMITS.minWidth, MEDIA_LIMITS.maxWidth], ['高', state.height, MEDIA_LIMITS.minHeight, MEDIA_LIMITS.maxHeight]] as const) {
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new ApplicationError('VALIDATION_FAILED', `图片${label}度须在 ${min}-${max} 像素之间`);
      }
    }
    if (!/^[0-9a-f]{64}$/.test(state.sha256)) throw new ApplicationError('VALIDATION_FAILED', '内容摘要格式无效');
    this.state = { ...state };
  }

  get isReady(): boolean {
    return this.state.status === 'ready';
  }

  markDeleted(now: Date): MediaAsset {
    if (this.state.status === 'deleted') return this;
    return new MediaAsset({ ...this.state, status: 'deleted', deletedAt: now });
  }
}

/** 由检测格式与时间生成服务端存储标识；客户端不参与路径。 */
export function buildStorageKey(format: MediaFormat, now: Date): string {
  return `products/${now.getUTCFullYear()}/${crypto.randomUUID()}.${FORMAT_EXTENSIONS[format]}`;
}
