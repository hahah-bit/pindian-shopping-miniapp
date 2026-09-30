import { imageSize } from 'image-size';
import { ApplicationError } from '../../../shared/kernel';
import { MEDIA_LIMITS, type MediaFormat } from '../domain/media-asset';

export interface InspectedImage {
  format: MediaFormat;
  width: number;
  height: number;
}

const MIME_BY_FORMAT: Record<MediaFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function contentTypeFor(format: MediaFormat): string {
  return MIME_BY_FORMAT[format];
}

function sniffFormat(buffer: Buffer): MediaFormat {
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(pngMagic)) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  throw new ApplicationError('UNSUPPORTED_MEDIA_TYPE', '仅支持 JPEG、PNG、WebP 格式图片');
}

/**
 * 服务端图片检查：魔数识别真实格式 + 头部解析宽高（可解码性）+ 尺寸界限。
 * 客户端文件名与声明类型不参与判定。
 */
export class ImageInspector {
  inspect(buffer: Buffer): InspectedImage {
    if (!buffer || buffer.length === 0) throw new ApplicationError('VALIDATION_FAILED', '未接收到文件内容');
    if (buffer.length > MEDIA_LIMITS.maxBytes) {
      throw new ApplicationError('PAYLOAD_TOO_LARGE', `图片不能超过 ${Math.floor(MEDIA_LIMITS.maxBytes / 1024 / 1024)} MiB`);
    }
    const format = sniffFormat(buffer);
    let width: number;
    let height: number;
    try {
      const size = imageSize(buffer);
      width = size.width;
      height = size.height;
    } catch {
      throw new ApplicationError('UNSUPPORTED_MEDIA_TYPE', '图片数据无法解码，文件可能已损坏');
    }
    // 截断文件可能解析出 0 或非法尺寸：视为不可解码而非尺寸超界。
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new ApplicationError('UNSUPPORTED_MEDIA_TYPE', '图片数据无法解码，文件可能已损坏');
    }
    if (
      !Number.isInteger(width) || !Number.isInteger(height) ||
      width < MEDIA_LIMITS.minWidth || width > MEDIA_LIMITS.maxWidth ||
      height < MEDIA_LIMITS.minHeight || height > MEDIA_LIMITS.maxHeight
    ) {
      throw new ApplicationError('VALIDATION_FAILED', `图片宽高须在 ${MEDIA_LIMITS.minWidth}-${MEDIA_LIMITS.maxWidth} 像素之间（当前 ${width}×${height}）`);
    }
    return { format, width, height };
  }
}
