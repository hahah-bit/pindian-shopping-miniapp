/** 微信能力端口：领域与应用不依赖微信 SDK；实现位于 adapters/outbound/wechat。 */

export interface WxSessionInfo {
  openid: string;
  unionid?: string;
}

export class WxCodeInvalidError extends Error {
  constructor(message = '登录凭证无效') {
    super(message);
    this.name = 'WxCodeInvalidError';
  }
}

export class WxUnavailableError extends Error {
  constructor(message = '微信服务暂不可用') {
    super(message);
    this.name = 'WxUnavailableError';
  }
}

export class WxRiskBlockedError extends Error {
  constructor(message = '登录被微信风控拦截') {
    super(message);
    this.name = 'WxRiskBlockedError';
  }
}

export class WxNotConfiguredError extends Error {
  constructor() {
    super('微信登录暂未配置');
    this.name = 'WxNotConfiguredError';
  }
}

/** 登录凭证校验（code2Session）。实现必须仅服务端调用。 */
export interface WxAuthPort {
  exchangeCodeForSession(code: string): Promise<WxSessionInfo>;
}

export interface WxPhoneInfo {
  purePhoneNumber: string;
  countryCode: string;
}

/** 手机号验证：code 一次性、5 分钟有效；openid 可选校验绑定关系。 */
export interface WxPhonePort {
  exchangePhoneNumberCode(code: string, openid: string | null): Promise<WxPhoneInfo>;
}
