import type { MediaUrlBuilder } from '../../../application/ports';

/** 按 PUBLIC_API_BASE_URL 生成公开访问地址；数据库只存 storageKey，不存 URL。 */
export class ConfigMediaUrlBuilder implements MediaUrlBuilder {
  constructor(private readonly publicApiBaseUrl: string) {}

  build(mediaId: string): string {
    return `${this.publicApiBaseUrl}/api/media/v1/assets/${mediaId}`;
  }
}
