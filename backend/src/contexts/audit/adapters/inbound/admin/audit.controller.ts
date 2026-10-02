import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { ApiResponse, AdminAuditLogItem, RolePermissionMatrix } from '@pindian/contracts';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';
import { AuditLogQueries } from '../../../application/audit-queries';
import { roleMatrix } from '../../../../identity-access/application/role-matrix';

/** 操作日志查询与角色权限矩阵（T009/F039，audit:view）；只读，不写审计。 */
@Controller('admin/v1')
export class AuditController {
  constructor(@Inject('AUDIT_LOG_QUERIES') private readonly queries: AuditLogQueries) {}

  @Get('audit/logs')
  @RequirePermissions('audit:view')
  async logs(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: AdminAuditLogItem[]; page: number; pageSize: number; total: number }>> {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? 10)));
    const result = await this.queries.listLogs({
      adminId: query.adminId ?? null,
      action: query.action ?? null,
      resourceType: query.resourceType ?? null,
      from: query.from ?? null,
      to: query.to ?? null,
      page,
      pageSize
    });
    return { data: { items: result.items as AdminAuditLogItem[], page, pageSize, total: result.total }, requestId: request.requestId };
  }

  @Get('access/role-matrix')
  @RequirePermissions('audit:view')
  async roleMatrixView(@Req() request: RequestWithPrincipal): Promise<ApiResponse<RolePermissionMatrix>> {
    void request;
    return { data: roleMatrix(), requestId: request.requestId };
  }
}
