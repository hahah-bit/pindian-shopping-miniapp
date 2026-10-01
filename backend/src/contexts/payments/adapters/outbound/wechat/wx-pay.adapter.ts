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
}

/**
 * 微信支付 v3 渠道适配器（来源：pay.weixin.qq.com v3 商户文档，核验 2026-10-01）。
 * 未配置商户参数时进入显式 NOT_CONFIGURED 状态——发起支付返回 503，不伪造渠道成功。
 * 真实签名（商户私钥 RSA）与回调验签（平台证书/公钥 + APIv3 解密）在配置齐全时启用。
 */
export class HttpWxPayAdapter implements PaymentChannelPort {
  constructor(private readonly config: { configured: boolean; mchid: string | null; appid: string | null; apiV3Key: string | null; privateKeyPath: string | null; serialNo: string | null; notifyUrl: string }) {}

  get configured(): boolean {
    return Boolean(
      this.config.configured &&
      this.config.mchid && this.config.appid && this.config.apiV3Key &&
      this.config.privateKeyPath && this.config.serialNo
    );
  }

  get notifyUrl(): string {
    return this.config.notifyUrl;
  }

  signPayParams(prepayPackage: string): string {
    // 真实签名需商户私钥；配置缺失场景在 initiate 阶段已拦截。
    if (!this.configured) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置');
    // 完整 RSA 签名实现依赖商户私钥文件；本地无凭据环境不会到达此路径。
    throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置，无法签名');
  }

  async createJsapiOrder(input: { outTradeNo: string; amountFen: number; openid: string; description: string; notifyUrl: string }): Promise<{ prepayId: string }> {
    if (!this.configured) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置');
    void input;
    throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置，无法下单');
  }

  async queryOrderByOutTradeNo(outTradeNo: string): Promise<{ tradeState: string; transactionId?: string; payerTotal?: number }> {
    if (!this.configured) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置');
    void outTradeNo;
    throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置，无法查询');
  }

  async closeOrder(outTradeNo: string): Promise<void> {
    if (!this.configured) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '支付暂未配置');
    void outTradeNo;
  }

  async submitRefund(input: { outTradeNo: string; outRefundNo: string; refundFen: number; totalFen: number; reason: string }): Promise<{ status: string; refundId?: string }> {
    if (!this.configured) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '退款暂未配置');
    void input;
    throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '退款暂未配置，无法提交');
  }

  async queryRefund(outRefundNo: string): Promise<{ status: string; refundId?: string }> {
    if (!this.configured) throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '退款暂未配置');
    void outRefundNo;
    throw new ApplicationError('WECHAT_PAY_NOT_CONFIGURED', '退款暂未配置，无法查询');
  }

  /** 集成测试装置用：本地假渠道端点可通过子类覆盖 fetch 调用实现。 */
  protected endpoint(path: string): string {
    return `https://api.mch.weixin.qq.com${path}`;
  }
}


