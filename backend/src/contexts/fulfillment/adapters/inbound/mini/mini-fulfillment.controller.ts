import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import { ApplicationError } from '../../../../../shared/kernel';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm } from '../../../../identity-access/adapters/inbound/admin/route-access';
import { MiniFulfillmentQueries, ConfirmReceiptUseCase, type MiniFulfillmentResult } from '../../../application/mini-fulfillment';

/** 小程序履约进度与确认收货（F030）：仅本人订单；他人一律 404。 */
@Controller('mini/v1')
export class MiniFulfillmentController {
  constructor(
    @Inject(MiniFulfillmentQueries) private readonly queries: MiniFulfillmentQueries,
    @Inject(ConfirmReceiptUseCase) private readonly confirmReceipt: ConfirmReceiptUseCase
  ) {}

  private requireUser(request: RequestWithPrincipal): string {
    const userId = request.userAuth?.userId;
    if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    return userId;
  }

  @AuthRealm('user')
  @Get('orders/:id/fulfillment')
  async byOrder(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<MiniFulfillmentResult>> {
    const result = await this.queries.execute({ orderId: id, userId: this.requireUser(request) });
    return { data: result, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('fulfillment-orders/:id/confirm-receipt')
  @HttpCode(200)
  async confirm(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ status: string; completedBy: string | null }>> {
    const result = await this.confirmReceipt.execute({ fulfillmentId: id, userId: this.requireUser(request) });
    return { data: result, requestId: request.requestId };
  }
}
