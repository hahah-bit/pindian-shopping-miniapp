import { Controller, Delete, Get, Inject, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ApiResponse, MediaAssetAdminView, MediaAssetView } from '@pindian/contracts';
import { RecordOperation } from '../../../../audit/application';
import { DeleteMediaAsset, ListMediaAssets, UploadMediaAsset } from '../../../application';
import { MEDIA_LIMITS } from '../../../domain';
import type { RequestWithAdmin } from '../../../../identity-access/adapters/inbound/admin/admin-auth.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';

@Controller('admin/v1/media')
export class AdminMediaController {
  constructor(
    @Inject(UploadMediaAsset) private readonly upload: UploadMediaAsset,
    @Inject(ListMediaAssets) private readonly list: ListMediaAssets,
    @Inject(DeleteMediaAsset) private readonly deleteAsset: DeleteMediaAsset,
    @Inject(RecordOperation) private readonly audit: RecordOperation
  ) {}

  @Post()
  @RequirePermissions('media:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_LIMITS.maxBytes } }))
  async uploadAsset(@UploadedFile() file: { buffer?: Buffer } | undefined, @Req() request: RequestWithAdmin): Promise<ApiResponse<MediaAssetView>> {
    const result = await this.upload.execute({ buffer: file?.buffer, uploadedBy: request.adminAuth?.adminId ?? null });
    await this.audit.execute({
      adminId: request.adminAuth?.adminId ?? null,
      action: 'media.upload',
      resourceType: 'media_asset',
      resourceId: result.id,
      detail: { format: result.format, width: result.width, height: result.height, sizeBytes: result.sizeBytes },
      requestId: request.requestId
    });
    return {
      data: {
        id: result.id, url: result.url, format: result.format as MediaAssetView['format'], width: result.width,
        height: result.height, sizeBytes: result.sizeBytes, createdAt: new Date().toISOString()
      },
      requestId: request.requestId
    };
  }

  @Get()
  @RequirePermissions('media:manage')
  async listAssets(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithAdmin): Promise<ApiResponse<{ items: MediaAssetAdminView[]; page: number; pageSize: number; total: number }>> {
    const result = await this.list.execute({ page: query.page, pageSize: query.pageSize });
    return {
      data: {
        ...result,
        items: result.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })) as MediaAssetAdminView[]
      },
      requestId: request.requestId
    };
  }

  @Delete(':id')
  @RequirePermissions('media:manage')
  async remove(@Param('id') id: string, @Req() request: RequestWithAdmin): Promise<ApiResponse<{ deleted: true }>> {
    const result = await this.deleteAsset.execute({ mediaId: id });
    await this.audit.execute({
      adminId: request.adminAuth?.adminId ?? null,
      action: 'media.delete',
      resourceType: 'media_asset',
      resourceId: id,
      requestId: request.requestId
    });
    return { data: result, requestId: request.requestId };
  }
}
