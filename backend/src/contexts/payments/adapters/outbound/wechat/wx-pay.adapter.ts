import { createSign, createVerify, randomBytes, createPrivateKey, createPublicKey, createDecipheriv, verify as verifySignature, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApplicationError } from '../../../../../shared/kernel';
import type { PaymentChannelPort } from '../../../application/ports';

export interface WxPayRuntimeConfig {
  configured: boolean;
  mchid: string | null;
  appid: string | null;
  apiV3Key: string | null;
  privateKeyPath: string | null;
  serialNo: string | null;
  notifyUrl: string;
  /** 平台公钥/证书公钥文件路径（回调验签；公钥模式序列号以 PUB_KEY_ID_ 开头）。 */
  platformPublicKeyPath?: string | null;
  /** 覆盖 API 域名（本地协议测试用；默认官方 api.mch.weixin.qq.com）。 */
  endpointBase?: string;
  /** 覆盖 fetch 实现（测试注入本地假渠道服务器）。 */
  fetchImpl?: typeof fetch;
}

function rfc3339Plus8(t: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+08:00`;
}

/**
 * 微信支付 v3 渠道适配器（官方文档：pay.weixin.qq.com/doc/v3/merchant，核验 2026-10-01）。
 * - 请求签名：WECHATPAY2-SHA256-RSA2048（商户私钥，serial_no = 商户证书序列号）。
 * - 调起支付 paySign：RSA-SHA256（串 = appId\n时间戳\n随机串\npackage\n）。
 * - 回调验签：平台公钥/证书（串 = 应答时间戳\n随机串\n报文体\n）。
 * - resource 解密：APIv3 密钥 AEAD_AES_256_GCM（tag 后置 16 字节）。
 * 未配置商户参数时全部方法显式抛 WECHAT_PAY_NOT_CONFIGURED——不伪造渠道成功。
 */
export class HttpWxPayAdapter implements PaymentChannelPort {
  private readonly privateKey: KeyObject | null;
  private readonly platformPublicKey: KeyObject | null;
  readonly configured: boolean;
  readonly notifyUrl: string;
  readonly mchid: string;
  readonly appid: string;
  readonly serialNo: string;
  private readonly apiV3Key: string;
  private readonly endpointBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: WxPayRuntimeConfig & { endpointBase?: string; fetchImpl?: typeof fetch }) {
    this.notifyUrl = config.notifyUrl;
    this.endpointBase = config.endpointBase ?? 'https://api.mch.weixin.qq.com';
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.mchid = config.mchid ?? '';
    this.appid = config.appid ?? '';
    this.serialNo = config.serialNo ?? '';
    this.apiV3Key = config.apiV3Key ?? '';
    this.configured = Boolean(config.mchid && config.appid && config.apiV3Key && config.privateKeyPath && config.serialNo);
    if (this.configured) {
      try {
        this.privateKey = createPrivateKey(readFileSync(config.privateKeyPath!, 'utf8'));
      } catch (error) {
        throw new ApplicationError('VALIDATION_FAILED', `微信支付商户私钥加载失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      this.privateKey = null;
    }
    if (config.platformPublicKeyPath) {
      try {
        this.platformPublicKey = createPublicKey(readFileSync(config.platformPublicKeyPath, 'utf8'));
      } catch (error) {
        throw new ApplicationError('VALIDATION_FAILED', `微信支付平台公钥加载失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      this.platformPublicKey = null;
    }
  }

  /** Authorization 头（官方：SHA256withRSA，串 = 方法\nURL路径\n时间戳\n随机串\n报文\n）。 */
  private authorizationHeader(method: string, pathWithQuery: string, body: string): string {
    if (!this.privateKey) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = createSign('RSA-SHA256').update(message).sign(this.privateKey, 'base64');
    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.serialNo}"`;
  }

  private async request<T>(method: 'GET' | 'POST', pathWithQuery: string, body?: unknown): Promise<T> {
    if (!this.configured) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置');
    const bodyText = body === undefined ? '' : JSON.stringify(body);
    const auth = this.authorizationHeader(method, pathWithQuery, bodyText);
    const response = await this.fetchImpl(`${this.endpointBase}${pathWithQuery}`, {
      method,
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'pindian-platform/0.1'
      },
      body: body === undefined ? undefined : bodyText,
      signal: AbortSignal.timeout(10_000)
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* 非 JSON 保留空对象 */ }
    if (!response.ok) {
      const errcode = String(parsed.code ?? `HTTP_${response.status}`);
      const message = String(parsed.message ?? '微信支付接口错误');
      if (response.status >= 500 || errcode === 'SYSTEM_ERROR') {
        const e = new Error(`${errcode}: ${message}`); (e as { code?: string }).code = 'CHANNEL_SYSTEM_ERROR'; throw e;
      }
      const e = new Error(`${errcode}: ${message}`); (e as { code?: string }).code = errcode; throw e;
    }
    return parsed as T;
  }

  /** 小程序/JSAPI 下单（POST /v3/pay/transactions/jsapi）。 */
  async createJsapiOrder(input: { outTradeNo: string; amountFen: number; openid: string; description: string; notifyUrl: string; timeExpire?: Date }): Promise<{ prepayId: string }> {
    const path = '/v3/pay/transactions/jsapi';
    const body: Record<string, unknown> = {
      appid: this.appid,
      mchid: this.mchid,
      description: input.description.slice(0, 127),
      out_trade_no: input.outTradeNo,
      notify_url: input.notifyUrl,
      amount: { total: input.amountFen, currency: 'CNY' },
      payer: { openid: input.openid }
    };
    if (input.timeExpire) body.time_expire = rfc3339Plus8(input.timeExpire);
    const result = await this.request<{ prepay_id: string }>('POST', path, body);
    return { prepayId: result.prepay_id };
  }

  /** 查询订单（GET /v3/pay/transactions/out-trade-no/{no}?mchid=）。 */
  async queryOrderByOutTradeNo(outTradeNo: string): Promise<{ tradeState: string; transactionId?: string; payerTotal?: number }> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(this.mchid)}`;
    const r = await this.request<{ trade_state: string; transaction_id?: string; amount?: { payer_total?: number } }>('GET', path);
    return { tradeState: r.trade_state, transactionId: r.transaction_id, payerTotal: r.amount?.payer_total };
  }

  /** 关单（POST /v3/pay/transactions/out-trade-no/{no}/close）。 */
  async closeOrder(outTradeNo: string): Promise<void> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`;
    await this.request<{ mchid: string }>('POST', path, { mchid: this.mchid });
  }

  /** 申请退款（POST /v3/refund/domestic/refunds；同 out_refund_no 幂等）。 */
  async submitRefund(input: { outTradeNo: string; outRefundNo: string; refundFen: number; totalFen: number; reason: string }): Promise<{ status: string; refundId?: string }> {
    const body = {
      out_trade_no: input.outTradeNo,
      out_refund_no: input.outRefundNo,
      reason: input.reason.slice(0, 80),
      notify_url: this.notifyUrl,
      amount: { refund: input.refundFen, total: input.totalFen, currency: 'CNY' }
    };
    const r = await this.request<{ status: string; refund_id?: string }>('POST', '/v3/refund/domestic/refunds', body);
    return { status: r.status, refundId: r.refund_id };
  }

  /** 查询退款（GET /v3/refund/domestic/refunds/{out_refund_no}）。 */
  async queryRefund(outRefundNo: string): Promise<{ status: string; refundId?: string }> {
    const r = await this.request<{ status: string; refund_id?: string }>('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`);
    return { status: r.status, refundId: r.refund_id };
  }

  /** 小程序调起支付完整参数（官方：RSA-SHA256，串 = appId\n时间戳\n随机串\npackage\n）。 */
  signPayParamsFull(prepayPackage: string): { paySign: string; timeStamp: string; nonceStr: string } {
    if (!this.privateKey) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置');
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const message = `${this.appid}\n${timestamp}\n${nonce}\n${prepayPackage}\n`;
    const paySign = createSign('RSA-SHA256').update(message).sign(this.privateKey, 'base64');
    return { paySign, timeStamp: timestamp, nonceStr: nonce };
  }

  signPayParams(prepayPackage: string): string {
    return this.signPayParamsFull(prepayPackage).paySign;
  }

  /** 回调验签（官方：串 = 应答时间戳\n随机串\n报文体\n，平台公钥 RSA-SHA256）。 */
  verifyNotifySignature(input: { timestamp: string; nonce: string; body: string; signature: string }): boolean {
    if (!this.platformPublicKey) return false;
    const message = `${input.timestamp}\n${input.nonce}\n${input.body}\n`;
    return verifySignature('RSA-SHA256', Buffer.from(message, 'utf8'), this.platformPublicKey, Buffer.from(input.signature, 'base64'));
  }

  /** APIv3 密钥 AEAD_AES_256_GCM 解密（官方：tag 后置 16 字节；AAD 为 associated_data）。 */
  decryptResource(ciphertextB64: string, nonce: string, associatedData?: string): string {
    if (!this.apiV3Key) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置');
    const buf = Buffer.from(ciphertextB64, 'base64');
    const authTag = buf.subarray(buf.length - 16);
    const data = buf.subarray(0, buf.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
    decipher.setAuthTag(authTag);
    if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}

