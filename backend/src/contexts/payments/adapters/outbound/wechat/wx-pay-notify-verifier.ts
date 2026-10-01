import { createDecipheriv, createPublicKey, createVerify, verify as verifySignature } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface NotifyHeaders {
  'wechatpay-serial'?: string;
  'wechatpay-signature'?: string;
  'wechatpay-timestamp'?: string;
  'wechatpay-nonce'?: string;
}

export interface NotifyVerifyResult {
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
}

/** 回调时间戳允许窗口（官方建议校验时间偏差，超窗视为重放拒绝）。 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * 微信支付 v3 回调验签 + 解密（官方文档核验 2026-10-01：
 * 回调验签指引 pay.weixin.qq.com/docs/merchant/development/interface-rules/signature-verification.html；
 * 退款结果通知 pay.weixin.qq.com/doc/v3/merchant/4012647469）。
 *
 * 安全不变量（复验 A01）：
 * - 必须配置平台公钥/微信支付公钥（未配置拒绝处理，不做"只解密"降级）；
 * - 四个 Wechatpay-* 头必须齐全；
 * - 验签串 = `timestamp\nnonce\n原始报文\n`（SHA256-RSA，平台公钥），作用于调用方传入的原始字节文本；
 * - 时间戳超窗拒绝；验签通过后才用 APIv3 密钥 AES-256-GCM 解密 resource（tag 后置 16 字节）。
 */
export class WxPayNotifyVerifier {
  private readonly platformPublicKey: ReturnType<typeof createPublicKey> | null;

  constructor(private readonly config: { configured: boolean; apiV3Key: string | null; mchid: string | null; platformPublicKeyPath?: string | null }) {
    let key: ReturnType<typeof createPublicKey> | null = null;
    if (config.platformPublicKeyPath) {
      try { key = createPublicKey(readFileSync(config.platformPublicKeyPath, 'utf8')); } catch { key = null; }
    }
    this.platformPublicKey = key;
  }

  /** rawBody 必须为原始请求体文本（不得重新序列化）。 */
  verify(rawBody: string, headers: NotifyHeaders): NotifyVerifyResult {
    const serial = headers['wechatpay-serial'];
    const signature = headers['wechatpay-signature'];
    const timestamp = headers['wechatpay-timestamp'];
    const nonce = headers['wechatpay-nonce'];
    if (!this.config.configured || !this.config.apiV3Key) return { valid: false, decrypted: null };
    if (!this.platformPublicKey) return { valid: false, decrypted: null };
    if (!serial || !signature || !timestamp || !nonce) return { valid: false, decrypted: null };
    if (!/^\d{1,14}$/.test(timestamp)) return { valid: false, decrypted: null };
    if (Math.abs(Date.now() - Number(timestamp) * 1000) > TIMESTAMP_TOLERANCE_MS) return { valid: false, decrypted: null };
    // 平台 RSA 验签（发送方身份）；失败即拒绝，不进入解密
    const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
    let signatureOk = false;
    try {
      signatureOk = verifySignature('RSA-SHA256', Buffer.from(message, 'utf8'), this.platformPublicKey, Buffer.from(signature, 'base64'));
    } catch {
      return { valid: false, decrypted: null };
    }
    if (!signatureOk) return { valid: false, decrypted: null };

    let parsed: { event_type?: string; resource?: { ciphertext?: string; nonce?: string; associated_data?: string } };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { valid: false, decrypted: null };
    }
    const resource = parsed.resource;
    if (!resource?.ciphertext || !resource.nonce) return { valid: false, decrypted: null };
    try {
      // 微信 v3：ciphertext = AES-256-GCM(报文) 追加 16 字节 auth tag
      const buf = Buffer.from(resource.ciphertext, 'base64');
      const authTag = buf.subarray(buf.length - 16);
      const data = buf.subarray(0, buf.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.config.apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
      decipher.setAuthTag(authTag);
      if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      const fact = JSON.parse(plain) as Record<string, unknown>;
      if (this.config.mchid && fact.mchid && fact.mchid !== this.config.mchid) return { valid: false, decrypted: null };
      return { valid: true, decrypted: projectFact(parsed.event_type ?? '', fact) };
    } catch {
      return { valid: false, decrypted: null };
    }
  }
}

function projectFact(eventType: string, fact: Record<string, unknown>): NotifyVerifyResult['decrypted'] {
  const amount = fact.amount as { payer_total?: number; total?: number; refund?: number } | undefined;
  if (eventType.startsWith('REFUND.')) {
    const outRefundNo = typeof fact.out_refund_no === 'string' ? fact.out_refund_no : '';
    if (!outRefundNo) return null;
    return {
      eventType,
      outRefundNo,
      refundStatus: typeof fact.refund_status === 'string' ? fact.refund_status : '',
      channelRefundId: typeof fact.refund_id === 'string' ? fact.refund_id : undefined,
      payload: fact
    };
  }
  const outTradeNo = typeof fact.out_trade_no === 'string' ? fact.out_trade_no : '';
  const channelTransactionId = typeof fact.transaction_id === 'string' ? fact.transaction_id : '';
  if (!outTradeNo || !channelTransactionId) return null;
  return {
    eventType: eventType || 'TRANSACTION.SUCCESS',
    outTradeNo,
    channelTransactionId,
    tradeState: typeof fact.trade_state === 'string' ? fact.trade_state : 'SUCCESS',
    payerTotal: amount?.payer_total ?? amount?.total ?? 0,
    payload: fact
  };
}
