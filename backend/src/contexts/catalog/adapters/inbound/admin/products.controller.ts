import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import { RecordOperation } from '../../../../audit/application';
import { requireProductId, UnpublishProduct, UpdateProduct } from '../../../application';
import type { RequestWithAdmin } from '../../../../identity-access/adapters/inbound/admin/admin-auth.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';
import { AdminCatalogQueries, CreateProductWorkflow, PublishProductWorkflow } from '../../../../../workflows';

@Controller('admin/v1/products')
export class AdminProductsController {
  constructor(
    @Inject(CreateProductWorkflow) private readonly createProduct: CreateProductWorkflow,
    @Inject(UpdateProduct) private readonly updateProduct: UpdateProduct,
    @Inject(PublishProductWorkflow) private readonly publishProduct: PublishProductWorkflow,
    @Inject(UnpublishProduct) private readonly unpublishProduct: UnpublishProduct,
    @Inject(AdminCatalogQueries) private readonly queries: AdminCatalogQueries,
    @Inject(RecordOperation) private readonly audit: RecordOperation
  ) {}

  @Get()
  @RequirePermissions('catalog:manage')
  async list(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    return { data: await this.queries.list(query), requestId: request.requestId };
  }

  @Post()
  @RequirePermissions('catalog:manage')
  async create(@Body() body: Record<string, unknown>, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    const { productId } = await this.createProduct.execute({ input: body, actorAdminId: request.adminAuth?.adminId ?? null });
    await this.audit.execute({
      adminId: request.adminAuth?.adminId ?? null,
      action: 'product.created',
      resourceType: 'product',
      resourceId: productId,
      detail: { name: body.name, initialStockWholeItems: body.initialStockWholeItems },
      requestId: request.requestId
    });
    const view = await this.queries.get(productId);
    return { data: view, requestId: request.requestId };
  }

  @Get(':id')
  @RequirePermissions('catalog:manage')
  async get(@Param('id') id: string, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    return { data: await this.queries.get(requireProductId(id)), requestId: request.requestId };
  }

  @Patch(':id')
  @RequirePermissions('catalog:manage')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    const updated = await this.updateProduct.execute({ productId: requireProductId(id), input: body });
    await this.audit.execute({
      adminId: request.adminAuth?.adminId ?? null,
      action: 'product.updated',
      resourceType: 'product',
      resourceId: updated.state.productId,
      detail: { name: updated.state.name },
      requestId: request.requestId
    });
    return { data: await this.queries.get(updated.state.productId), requestId: request.requestId };
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions('catalog:manage')
  async publish(@Param('id') id: string, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    const productId = requireProductId(id);
    await this.publishProduct.execute({ productId });
    await this.audit.execute({
      adminId: request.adminAuth?.adminId ?? null, action: 'product.published', resourceType: 'product', resourceId: productId,
      requestId: request.requestId
    });
    return { data: await this.queries.get(productId), requestId: request.requestId };
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @RequirePermissions('catalog:manage')
  async unpublish(@Param('id') id: string, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    const productId = requireProductId(id);
    await this.unpublishProduct.execute({ productId });
    await this.audit.execute({
      adminId: request.adminAuth?.adminId ?? null, action: 'product.unpublished', resourceType: 'product', resourceId: productId,
      requestId: request.requestId
    });
    return { data: await this.queries.get(productId), requestId: request.requestId };
  }
}
