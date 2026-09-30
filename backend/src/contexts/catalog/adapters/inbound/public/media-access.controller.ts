import { Controller, Get, Header, Inject, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ReadMediaAsset } from '../../../application';
import { PublicRoute } from '../../../../identity-access/adapters/inbound/admin/route-access';

/** 公开图片读取：仅 ready 资源；资源内容不可变，使用长缓存。 */
@Controller('media/v1/assets')
export class MediaAccessController {
  constructor(@Inject(ReadMediaAsset) private readonly read: ReadMediaAsset) {}

  @PublicRoute()
  @Get(':id')
  async readAsset(@Param('id') id: string, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const opened = await this.read.execute(id);
    response.setHeader('Content-Type', opened.contentType);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Content-Length', String(opened.size));
    return new StreamableFile(opened.stream);
  }
}
