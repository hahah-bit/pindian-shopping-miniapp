import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiResponse, MiniOrderView } from '@pindian/contracts';
import { ApplicationError } from '../../../../../shared/kernel';
import { InitiatePayment } from '../../../../payments/application/initiate-payment';
import { PaymentQueryResult } from '../../../../payments/application/payment-query-result';
import { MiniRefundQueries } from '../../../../payments/application/mini-refund-views';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm } from '../../../../identity-access/adapters/inbound/admin/route-access';

/** 小程序支付：发起（幂等）/结果查询（以后端为准）/退款进度。 */
@Controller('mini/v1/orders')
export class MiniPayController {
  constructor(
    @Inject(InitiatePayment) private readonly initiatePayment: InitiatePayment,
    @Inject(PaymentQueryResult) private readonly queryResult: PaymentQueryResult,
    @Inject(MiniRefundQueries) private readonly refundQueries: MiniRefundQueries
  ) {}

  @AuthRealm('user')
  @Post(':id/pay')
  async pay(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<Record<string, unknown>>> {
    const userId = request.userAuth?.userId;
    if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    const result = await this.initiatePayment.execute({ orderId: id, userId });
    if (result.status === 'unknown') {
      return {
        data: { paymentId: result.paymentId, status: 'unknown', message: '支付结果确认中，请稍后刷新查询' },
        requestId: request.requestId
      };
    }
    return { data: { paymentId: result.paymentId, status: 'processing', payParams: result.payParams }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post(':id/payment-result')
  @HttpCode(200)
  async paymentResult(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<MiniOrderView>> {
    const userId = request.userAuth?.userId;
    if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    const view = await this.queryResult.execute({ orderId: id, userId });
    return { data: view, requestId: request.requestId };
  }

  /** 退款进度（仅本人订单；事实只读）。 */
  @AuthRealm('user')
  @Get(':id/refunds')
  async refunds(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: unknown[] }>> {
    const userId = request.userAuth?.userId;
    if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    const result = await this.refundQueries.execute({ orderId: id, userId });
    return { data: result, requestId: request.requestId };
  }
}
