import { Body, Controller, Headers, HttpCode, Inject, Post } from '@nestjs/common';
import { ApplicationError } from '../../../../../shared/kernel';
import { PublicRoute } from '../../../../identity-access/adapters/inbound/admin/route-access';

export interface NotifyApplier {
  apply(fact: { outTradeNo: string; channelTransactionId: string; payerTotal: number; payload: Record<string, unknown> }): Promise<boolean>;
}

export interface NotifyVerifierPort {
  verify(rawBody: string, headers: Record<string, string | undefined>): { valid: boolean; decrypted: { outTradeNo: string; channelTransactionId: string; tradeState: string; payerTotal: number; payload: Record<string, unknown> } | null };
}

/** 微信支付回调（D010）：验签+解密+幂等应用。验签失败 400，成功 200 无需报文。 */
@Controller('payments/v1')
export class NotifyController {
  constructor(
    @Inject('NOTIFY_VERIFIER') private readonly verifier: NotifyVerifierPort,
    @Inject('NOTIFY_APPLIER') private readonly applier: NotifyApplier
  ) {}

  @PublicRoute()
  @Post('notify')
  @HttpCode(200)
  async notify(@Headers() headers: Record<string, string | undefined>, @Body() rawBody: unknown): Promise<Record<string, string> | undefined> {
    const raw = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? {});
    const result = this.verifier.verify(raw, headers);
    if (!result.valid || !result.decrypted) throw new ApplicationError('NOTIFY_INVALID', '回调验签失败');
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
