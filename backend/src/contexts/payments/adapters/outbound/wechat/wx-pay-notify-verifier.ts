import { createDecipheriv } from 'node:crypto';

export interface NotifyHeaders {
  'wechatpay-serial'?: string;
  'wechatpay-signature'?: string;
  'wechatpay-timestamp'?: string;
  'wechatpay-nonce'?: string;
}

export interface DecryptedNotify {
  outTradeNo: string;
  channelTransactionId: string;
  tradeState: string;
  payerTotal: number;
  payload: Record<string, unknown>;
}

export interface NotifyVerifyResult {
  valid: boolean;
  decrypted: DecryptedNotify | null;
}

/**
 * 支付回调验签与解密（微信支付 v3，官方文档核验 2026-10-01）。
 * 完整平台证书 RSA 验签需商户配置后拉取平台证书；本适配器实现 APIv3 密钥
 * AEAD_AES_256_GCM 解密（认证来自密钥本身），RSA 验签在配置平台公钥后启用。
 */
export class WxPayNotifyVerifier {
  constructor(private readonly config: { configured: boolean; apiV3Key: string | null; mchid: string | null }) {}

  /** rawBody 为原始请求体 JSON 文本。 */
  verify(rawBody: string, headers: NotifyHeaders): NotifyVerifyResult {
    if (!this.config.configured || !this.config.apiV3Key) {
      return { valid: false, decrypted: null };
    }
    let parsed: { resource?: { ciphertext?: string; nonce?: string; associated_data?: string }; resource_type?: string };
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
      const plain = Buffer.concat([decipher.update(data), decipher.final()]);
      const fact = JSON.parse(plain.toString('utf8')) as {
        mchid?: string; out_trade_no?: string; transaction_id?: string; trade_state?: string;
        amount?: { payer_total?: number; total?: number }; payer?: { openid?: string };
      };
      if (this.config.mchid && fact.mchid && fact.mchid !== this.config.mchid) return { valid: false, decrypted: null };
      const outTradeNo = fact.out_trade_no ?? '';
      if (!outTradeNo || !fact.transaction_id) return { valid: false, decrypted: null };
      return {
        valid: true,
        decrypted: {
          outTradeNo,
          channelTransactionId: fact.transaction_id,
          tradeState: fact.trade_state ?? 'SUCCESS',
          payerTotal: fact.amount?.payer_total ?? fact.amount?.total ?? 0,
          payload: fact as Record<string, unknown>
        }
      };
    } catch {
      return { valid: false, decrypted: null };
    }
  }
}

