import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import { RecordOperation } from '../../../../audit/application';
import { AdjustStock, ListStockMovements } from '../../../application';
import { requireProductId } from '../../../../catalog/application';
import type { RequestWithAdmin } from '../../../../identity-access/adapters/inbound/admin/admin-auth.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';

@Controller('admin/v1/products')
export class AdminStockController {
  constructor(
    @Inject(AdjustStock) private readonly adjustStock: AdjustStock,
    @Inject(ListStockMovements) private readonly listMovements: ListStockMovements,
    @Inject(RecordOperation) private readonly audit: RecordOperation
  ) {}

  @Post(':id/stock-adjustments')
  @HttpCode(200)
  @RequirePermissions('inventory:manage')
  async adjust(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    const productId = requireProductId(id);
    const result = await this.adjustStock.execute({
      productId,
      command: { delta: body.delta, setTo: body.setTo, reason: body.reason, requestId: body.requestId },
      actorAdminId: request.adminAuth?.adminId ?? null
    });
    await this.audit.execute({
      adminId: request.adminAuth?.adminId ?? null,
      action: 'stock.adjusted',
      resourceType: 'product',
      resourceId: productId,
      detail: { delta: body.delta, setTo: body.setTo, reason: body.reason, idempotentReplay: result.idempotentReplay },
      requestId: request.requestId
    });
    return {
      data: {
        stock: { ...result.stock, updatedAt: result.stock.updatedAt.toISOString() },
        movement: result.movement
          ? { ...result.movement, id: String(result.movement.id), createdAt: result.movement.createdAt.toISOString(), productId }
          : undefined,
        idempotentReplay: result.idempotentReplay
      },
      requestId: request.requestId
    };
  }

  @Get(':id/stock-movements')
  @RequirePermissions('inventory:manage')
  async movements(@Param('id') id: string, @Query() query: Record<string, string | undefined>, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    const result = await this.listMovements.execute({
      productId: requireProductId(id),
      page: query.page === undefined ? undefined : Number(query.page),
      pageSize: query.pageSize === undefined ? undefined : Number(query.pageSize)
    });
    return {
      data: {
        ...result,
        items: (result.items as { createdAt: Date; id: string }[]).map((movement) => ({ ...movement, id: String(movement.id), createdAt: movement.createdAt.toISOString() }))
      },
      requestId: request.requestId
    };
  }
}
