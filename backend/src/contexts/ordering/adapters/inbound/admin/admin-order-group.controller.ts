import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import type { ApiResponse, AdminGroupListItem, AdminOrderListItem } from '@pindian/contracts';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';
import type { AdminGroupQueries, AdminOrderQueries } from '../../../../ordering/application/admin-views';

function iso(value: Date | undefined): string {
  return (value ?? new Date(0)).toISOString();
}

/** 后台订单/拼单组查询（order:manage 权限；脱敏投影；无改状态接口）。 */
@Controller('admin/v1')
export class AdminOrderGroupController {
  constructor(
    @Inject('ADMIN_ORDER_QUERIES') private readonly orderQueries: AdminOrderQueries,
    @Inject('ADMIN_GROUP_QUERIES') private readonly groupQueries: AdminGroupQueries
  ) {}

  private num(value: string | undefined): number | undefined {
    return value === undefined ? undefined : Number(value);
  }

  @Get('orders')
  @RequirePermissions('order:manage')
  async listOrders(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: AdminOrderListItem[]; page: number; pageSize: number; total: number }>> {
    void request;
    const result = await this.orderQueries.list({ status: query.status, keyword: query.keyword, page: this.num(query.page), pageSize: this.num(query.pageSize) });
    return { data: result, requestId: request.requestId };
  }

  @Get('orders/:id')
  @RequirePermissions('order:manage')
  async getOrder(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<Record<string, unknown>>> {
    return { data: await this.orderQueries.get(id), requestId: request.requestId };
  }

  @Get('groups')
  @RequirePermissions('order:manage')
  async listGroups(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: AdminGroupListItem[]; page: number; pageSize: number; total: number }>> {
    void request;
    const result = await this.groupQueries.list({ status: query.status, productId: query.productId, page: this.num(query.page), pageSize: this.num(query.pageSize) });
    return { data: result, requestId: request.requestId };
  }

  @Get('groups/:id')
  @RequirePermissions('order:manage')
  async getGroup(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<Record<string, unknown>>> {
    return { data: await this.groupQueries.get(id), requestId: request.requestId };
  }
}
