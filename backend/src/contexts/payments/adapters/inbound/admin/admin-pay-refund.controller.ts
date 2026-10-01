import { Controller, Get, Post, HttpCode, Inject, Param, Body, Query, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';
import { RetryRefund } from '../../../application/refund-flow';

export interface AdminPayRefundQueries {
  listPayments(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: unknown[]; total: number }>;
  listRefunds(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: unknown[]; total: number }>;
  countPendingReview(): Promise<number>;
  countFailedRefunds(): Promise<number>;
}

/** 后台支付/退款查询、异常队列与失败退款重试（order:manage；状态推进只走渠道与 Worker）。 */
@Controller('admin/v1')
export class AdminPayRefundController {
  constructor(
    @Inject('ADMIN_PAY_REFUND_QUERIES') private readonly queries: AdminPayRefundQueries,
    @Inject(RetryRefund) private readonly retryRefund: RetryRefund
  ) {}

  @Get('payments')
  @RequirePermissions('order:manage')
  async payments(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    void request;
    return { data: await this.queries.listPayments({ status: query.status ?? null, page: Number(query.page ?? 1), pageSize: Math.min(50, Number(query.pageSize ?? 10)) }), requestId: request.requestId };
  }

  @Get('refunds')
  @RequirePermissions('order:manage')
  async refunds(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    void request;
    return { data: await this.queries.listRefunds({ status: query.status ?? null, page: Number(query.page ?? 1), pageSize: Math.min(50, Number(query.pageSize ?? 10)) }), requestId: request.requestId };
  }

  @Get('payment-anomalies')
  @RequirePermissions('order:manage')
  async anomalies(@Req() request: RequestWithPrincipal): Promise<ApiResponse<{ pendingReviewPayments: number; failedRefunds: number }>> {
    return { data: { pendingReviewPayments: await this.queries.countPendingReview(), failedRefunds: await this.queries.countFailedRefunds() }, requestId: request.requestId };
  }

  /** 失败退款人工重试：仅 failed 且未超重试上限；写操作审计。 */
  @Post('refunds/:id/retry')
  @HttpCode(200)
  @RequirePermissions('order:manage')
  async retry(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() request: RequestWithPrincipal
  ): Promise<ApiResponse<{ status: string }>> {
    const result = await this.retryRefund.execute({
      refundId: id,
      adminId: request.adminAuth?.adminId ?? null,
      requestId: request.requestId,
      reason: body?.reason
    });
    return { data: result, requestId: request.requestId };
  }
}
