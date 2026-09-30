import { ApplicationError } from '../../../../../shared/kernel';
import { WxCodeInvalidError, WxNotConfiguredError, WxPhoneInfo, WxRiskBlockedError, WxUnavailableError, WxAuthPort, WxPhonePort, WxSessionInfo } from '../../../application/user/wx-ports';
import type { RuntimeConfig } from '../../../../../bootstrap/config';

// 测试装置可覆盖（WX_API_BASE_URL 指向本地假微信服务）；生产默认官方端点。
const WX_API_BASE = process.env.WX_API_BASE_URL?.trim() || 'https://api.weixin.qq.com';

interface WxErrorResponse {
  errcode?: number;
  errmsg?: string;
}

function mapLoginError(errcode: number, errmsg: string): never {
  if (errcode === 40029) throw new WxCodeInvalidError();
  if (errcode === 40226) throw new WxRiskBlockedError();
  if (errcode === 40013) throw new WxUnavailableError(`微信配置不匹配（${errmsg}）`);
  throw new WxUnavailableError(`微信接口错误 ${errcode}`);
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new WxUnavailableError('连接微信服务失败');
  }
  if (!response.ok) throw new WxUnavailableError(`微信接口 HTTP ${response.status}`);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return body;
}

/**
 * code2Session HTTP 适配器（来源：微信官方文档，核验 2026-09-30）。
 * 未配置凭据时进入显式 NOT_CONFIGURED 状态：登录返回 503，不伪造会话。
 */
export class HttpWxAuthAdapter implements WxAuthPort {
  constructor(private readonly config: RuntimeConfig) {}

  get configured(): boolean {
    return Boolean(this.config.wxAppid && this.config.wxAppSecret);
  }

  async exchangeCodeForSession(code: string): Promise<WxSessionInfo> {
    if (!this.configured) throw new WxNotConfiguredError();
    const url = `${WX_API_BASE}/sns/jscode2session?appid=${encodeURIComponent(this.config.wxAppid!)}&secret=${encodeURIComponent(this.config.wxAppSecret!)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const body = await fetchJson(url);
    const errcode = body.errcode as number | undefined;
    if (errcode !== undefined && errcode !== 0) mapLoginError(errcode, String(body.errmsg ?? ''));
    const openid = body.openid as string | undefined;
    if (!openid) throw new WxUnavailableError('微信未返回 openid');
    return { openid, unionid: body.unionid as string | undefined };
  }
}

/**
 * 稳定版 access_token（POST /cgi-bin/stable_token，7200s）进程内缓存。
 * 注意：stable_token 与旧 getAccessToken 相互隔离，混用会导致对方失效——本项目统一只用 stable_token。
 */
export class HttpWxAccessTokenAdapter {
  private cached: { token: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(private readonly config: RuntimeConfig) {}

  get configured(): boolean {
    return Boolean(this.config.wxAppid && this.config.wxAppSecret);
  }

  async getToken(forceRefresh = false): Promise<string> {
    if (!this.configured) throw new WxNotConfiguredError();
    const now = Date.now();
    if (!forceRefresh && this.cached && this.cached.expiresAt > now + 5 * 60_000) return this.cached.token;
    if (!forceRefresh && this.inflight) return this.inflight;
    const request = (async () => {
      const body = await fetchJson(`${WX_API_BASE}/cgi-bin/stable_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credential', appid: this.config.wxAppid, secret: this.config.wxAppSecret, force_refresh: forceRefresh })
      });
      const errcode = body.errcode as number | undefined;
      if (errcode !== undefined && errcode !== 0) mapLoginError(errcode, String(body.errmsg ?? ''));
      const token = body.access_token as string | undefined;
      const expiresIn = body.expires_in as number | undefined;
      if (!token || !expiresIn) throw new WxUnavailableError('微信未返回 access_token');
      this.cached = { token, expiresAt: now + expiresIn * 1000 };
      return token;
    })();
    this.inflight = request.finally(() => { this.inflight = null; });
    return request;
  }
}

/** 手机号验证适配器（POST /wxa/business/getuserphonenumber，code 一次性 5 分钟）。 */
export class HttpWxPhoneAdapter implements WxPhonePort {
  constructor(private readonly tokens: HttpWxAccessTokenAdapter) {}

  async exchangePhoneNumberCode(code: string, openid: string | null): Promise<WxPhoneInfo> {
    const token = await this.tokens.getToken();
    const body = await fetchJson(`${WX_API_BASE}/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...(openid ? { openid } : {}) })
    });
    const errcode = body.errcode as number | undefined;
    if (errcode !== undefined && errcode !== 0) {
      if (errcode === 40029 || errcode === 40013) throw new ApplicationError('PHONE_CODE_INVALID', '手机号授权凭证无效，请重新点击授权');
      if (errcode === 45011) throw new WxUnavailableError('微信接口调用过于频繁');
      throw new WxUnavailableError(`微信接口错误 ${errcode}`);
    }
    const phoneInfo = body.phone_info as { purePhoneNumber?: string; countryCode?: string } | undefined;
    const pure = phoneInfo?.purePhoneNumber;
    if (!pure) throw new WxUnavailableError('微信未返回手机号');
    return { purePhoneNumber: pure, countryCode: phoneInfo?.countryCode ?? '86' };
  }
}
