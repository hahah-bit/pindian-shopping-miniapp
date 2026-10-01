import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ApiResponse, MiniOrderView } from '@pindian/contracts';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../../../../shared/kernel';
import { InitiatePayment } from '../../../../payments/application/initiate-payment';
import { PaymentQueryResult } from '../../../../payments/application/payment-query-result';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm } from '../../../../identity-access/adapters/inbound/admin/route-access';

/** 小程序支付：发起（幂等）/结果查询（以后端为准）。 */
@Controller('mini/v1/orders')
export class MiniPayController {
  constructor(
    @Inject(InitiatePayment) private readonly initiatePayment: InitiatePayment,
    @Inject(PaymentQueryResult) private readonly queryResult: PaymentQueryResult
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
}

/** 微信支付回调（验签+解密+幂等应用）。公开路由（微信服务器调用），验签失败返回 4xx。 */
@Controller('payments/v1')
export class PaymentNotifyController {
  constructor(
    @Inject('NOTIFY_VERIFIER') private readonly verifier: { verify(rawBody: string, headers: Record<string, string | undefined>): { valid: boolean; decrypted: { outTradeNo: string; channelTransactionId: string; tradeState: string; payerTotal: number; payload: Record<string, unknown> } | null } },
    @Inject('PAYMENT_CONFIRM_APPLIER') private readonly applier: { apply(fact: { outTradeNo: string; channelTransactionId: string; payerTotal: number; payload: Record<string, unknown> }): Promise<boolean> }
  ) {}

  @Post('notify')
  @HttpCode(200)
  async notify(
    @Headers() headers: Record<string, string | undefined>,
    @Body() rawBody: unknown
  ): Promise<Record<string, string> | undefined> {
    const raw = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? {});
    const result = this.verifier.verify(raw, headers);
    if (!result.valid || !result.decrypted) {
      throw new ApplicationError('NOTIFY_INVALID', '回调验签失败');
    }
    if (result.decrypted.tradeState === 'SUCCESS') {
      await this.applier.apply({
        outTradeNo: result.decrypted.outTradeNo,
        channelTransactionId: result.decrypted.channelTransactionId,
        payerTotal: result.decrypted.payerTotal,
        payload: result.decrypted.payload
      });
    }
    return undefined;
  }
}

void randomUUID;
