import { Body, Controller, Headers, HttpCode, Inject, Post, RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApplicationError } from '../../../../../shared/kernel';
import { PublicRoute } from '../../../../identity-access/adapters/inbound/admin/route-access';

export interface NotifyApplier {
  apply(fact: { outTradeNo: string; channelTransactionId: string; payerTotal: number; payload: Record<string, unknown> }): Promise<boolean>;
  /** 退款结果（渠道证据）：SUCCESS/ABNORMAL/CLOSED/PROCESSING；channelRefundId 随证据记录。 */
  applyRefund(fact: { outRefundNo: string; result: 'SUCCESS' | 'ABNORMAL' | 'CLOSED' | 'PROCESSING'; source: 'callback' | 'query'; channelRefundId?: string }): Promise<string>;
}

export interface NotifyVerifierPort {
  verify(rawBody: string, headers: Record<string, string | undefined>): {
    valid: boolean;
    decrypted: {
      eventType: string;
      outTradeNo?: string;
      channelTransactionId?: string;
      tradeState?: string;
      payerTotal?: number;
      outRefundNo?: string;
      refundStatus?: string;
      channelRefundId?: string;
      payload: Record<string, unknown>;
    } | null;
  };
}

const REFUND_RESULT_STATUSES = new Set(['SUCCESS', 'ABNORMAL', 'CLOSED', 'PROCESSING']);

/**
 * 微信支付/退款回调（复验 A01 + R6）：
 * - 验签作用于原始请求体（rawBody），缺 rawBody、缺/错签名一律 400；
 * - 按 event_type 分发：TRANSACTION.* → 支付确认；REFUND.* → 退款结果确认（幂等）；
 * - 成功应答 200 无需报文（官方：200/204 即已受理）。
 */
@Controller('payments/v1')
export class NotifyController {
  constructor(
    @Inject('NOTIFY_VERIFIER') private readonly verifier: NotifyVerifierPort,
    @Inject('NOTIFY_APPLIER') private readonly applier: NotifyApplier
  ) {}

  @PublicRoute()
  @Post('notify')
  @HttpCode(200)
  async notify(
    @Headers() headers: Record<string, string | undefined>,
    @Req() request: RawBodyRequest<Request>,
    @Body() parsedBody: unknown
  ): Promise<Record<string, string> | undefined> {
    const raw = request.rawBody?.toString('utf8') ?? (typeof parsedBody === 'string' ? parsedBody : '');
    // 验签必须作用于原始字节；解析后再序列化会破坏签名，因此 rawBody 缺失直接拒绝
    if (!raw) throw new ApplicationError('NOTIFY_INVALID', '回调报文缺失');
    const result = this.verifier.verify(raw, headers);
    if (!result.valid || !result.decrypted) throw new ApplicationError('NOTIFY_INVALID', '回调验签失败');
    const fact = result.decrypted;
    if (fact.eventType.startsWith('REFUND.')) {
      if (fact.refundStatus && REFUND_RESULT_STATUSES.has(fact.refundStatus)) {
        await this.applier.applyRefund({ outRefundNo: fact.outRefundNo ?? '', result: fact.refundStatus as 'SUCCESS' | 'ABNORMAL' | 'CLOSED' | 'PROCESSING', source: 'callback', channelRefundId: fact.channelRefundId });
      }
      return undefined;
    }
    if (fact.tradeState === 'SUCCESS') {
      await this.applier.apply({
        outTradeNo: fact.outTradeNo ?? '',
        channelTransactionId: fact.channelTransactionId ?? '',
        payerTotal: fact.payerTotal ?? 0,
        payload: fact.payload
      });
    }
    return undefined;
  }
}

void Body;
