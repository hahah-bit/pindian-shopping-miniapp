import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import type { ApiResponse, ReportingOverviewResult, ReportingCsResult } from '@pindian/contracts';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';
import { ReportingQueries } from '../../../application/reporting-queries';

/** 运营看板（T009/F037）：只读统计；overview 需 reporting:view，客服数据需 reporting:view_cs（D025）。 */
@Controller('admin/v1/reporting')
export class ReportingController {
  constructor(@Inject('REPORTING_QUERIES') private readonly queries: ReportingQueries) {}

  @Get('overview')
  @RequirePermissions('reporting:view')
  async overview(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<ReportingOverviewResult>> {
    void request;
    const result = await this.queries.overview({ date: query.date });
    return { data: result, requestId: request.requestId };
  }

  @Get('customer-service')
  @RequirePermissions('reporting:view_cs')
  async customerService(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<ReportingCsResult>> {
    void request;
    const result = await this.queries.csMetrics({ date: query.date });
    return { data: result, requestId: request.requestId };
  }
}
