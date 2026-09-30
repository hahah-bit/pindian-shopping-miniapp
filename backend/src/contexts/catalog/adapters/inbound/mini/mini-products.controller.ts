import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import { MiniCatalogQueries } from '../../../../../workflows';
import type { RequestWithAdmin } from '../../../../identity-access/adapters/inbound/admin/admin-auth.guard';
import { PublicRoute } from '../../../../identity-access/adapters/inbound/admin/route-access';

/** 小程序公开商品接口：仅上架商品；无鉴权、无后台字段。 */
@Controller('mini/v1/products')
export class MiniProductsController {
  constructor(@Inject(MiniCatalogQueries) private readonly queries: MiniCatalogQueries) {}

  @PublicRoute()
  @Get()
  async list(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    return { data: await this.queries.list(query), requestId: request.requestId };
  }

  @PublicRoute()
  @Get(':id')
  async get(@Param('id') id: string, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    return { data: await this.queries.get(id), requestId: request.requestId };
  }
}
