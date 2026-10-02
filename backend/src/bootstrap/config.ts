import { existsSync } from 'node:fs';

export interface RuntimeConfig {
  appEnv: 'local' | 'simulation' | 'production';
  wxApiBaseUrl: string | null;
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  mediaDir: string;
  publicApiBaseUrl: string;
  adminSessionTtlMinutes: number;
  userSessionTtlMinutes: number;
  wxAppid: string | null;
  wxPayMchid: string | null;
  wxPayApiV3Key: string | null;
  wxPaySerialNo: string | null;
  wxPayPrivateKeyPath: string | null;
  /** 平台公钥/微信支付公钥 PEM 路径（回调强制验签；未配置则回调全部拒绝）。 */
  wxPayPlatformPublicKeyPath: string | null;
  wxPayNotifyUrl: string;
  /** 覆盖渠道 API 域名（仅联调/测试注入本地假渠道；默认官方域名）。 */
  wxPayEndpointBase: string | null;
  wxAppSecret: string | null;
  /** D022 客服首响超时阈值（分钟）：超时提醒任务与看板超时计数共用。 */
  csFirstResponseTimeoutMinutes: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`配置 ${value} 必须为正整数`);
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const appEnv = env.APP_ENV ?? 'local';
  if (!['local', 'simulation', 'production'].includes(appEnv)) throw new Error('APP_ENV 必须是 local、simulation 或 production');
  if (appEnv === 'production') {
    if (env.WX_API_BASE_URL || env.WX_PAY_ENDPOINT_BASE || env.SIMULATION_CONTROL_TOKEN) throw new Error('生产环境禁止模拟渠道与端点覆盖');
    const required = ['WX_APPID','WX_APP_SECRET','WX_PAY_MCHID','WX_PAY_APIV3_KEY','WX_PAY_SERIAL_NO','WX_PAY_PRIVATE_KEY_PATH','WX_PAY_PLATFORM_PUBLIC_KEY_PATH','WX_PAY_NOTIFY_URL','PUBLIC_API_BASE_URL','CORS_ORIGINS'];
    if (required.some((key) => !env[key]?.trim())) throw new Error('生产环境必须完整配置微信、回调、域名和密钥');
    if (env.WX_PAY_APIV3_KEY?.length !== 32) throw new Error('生产 APIv3 密钥长度不正确');
    for (const key of ['WX_PAY_PRIVATE_KEY_PATH','WX_PAY_PLATFORM_PUBLIC_KEY_PATH']) if (!existsSync(env[key]!)) throw new Error('生产密钥文件不可读');
    for (const value of [env.PUBLIC_API_BASE_URL!, env.WX_PAY_NOTIFY_URL!, ...env.CORS_ORIGINS!.split(',')]) {
      let url: URL; try { url = new URL(value.trim()); } catch { throw new Error('生产域名配置无效'); }
      if (url.protocol !== 'https:' || ['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname)) throw new Error('生产域名和回调必须使用 HTTPS 公网域名');
    }
  }
  const port = Number(env.PORT ?? env.API_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为有效端口');
  if (!env.DATABASE_URL) throw new Error('必须设置 DATABASE_URL');
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL 格式无效'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname === '/') {
    throw new Error('DATABASE_URL 必须是含数据库名的 PostgreSQL URL');
  }
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error();
    } catch { throw new Error('CORS_ORIGINS 必须为逗号分隔的 HTTP(S) origin'); }
  }
  let publicApiBaseUrl = env.PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3000';
  try {
    const parsed = new URL(publicApiBaseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    publicApiBaseUrl = parsed.origin;
  } catch { throw new Error('PUBLIC_API_BASE_URL 必须为 HTTP(S) origin'); }
  return {
    appEnv: appEnv as RuntimeConfig['appEnv'],
    wxApiBaseUrl: env.WX_API_BASE_URL?.trim() || null,
    port,
    databaseUrl: env.DATABASE_URL,
    corsOrigins,
    mediaDir: env.MEDIA_DIR ?? 'data/media',
    publicApiBaseUrl,
    adminSessionTtlMinutes: parsePositiveInt(env.ADMIN_SESSION_TTL_MINUTES, 720),
    userSessionTtlMinutes: parsePositiveInt(env.USER_SESSION_TTL_MINUTES, 20160),
    wxAppid: env.WX_APPID?.trim() || null,
    wxAppSecret: env.WX_APP_SECRET?.trim() || null,
    wxPayMchid: env.WX_PAY_MCHID?.trim() || null,
    wxPayApiV3Key: env.WX_PAY_APIV3_KEY?.trim() || null,
    wxPaySerialNo: env.WX_PAY_SERIAL_NO?.trim() || null,
    wxPayPrivateKeyPath: env.WX_PAY_PRIVATE_KEY_PATH?.trim() || null,
    wxPayPlatformPublicKeyPath: env.WX_PAY_PLATFORM_PUBLIC_KEY_PATH?.trim() || null,
    wxPayNotifyUrl: env.WX_PAY_NOTIFY_URL?.trim() || 'http://localhost:3000/api/payments/v1/notify',
    wxPayEndpointBase: env.WX_PAY_ENDPOINT_BASE?.trim() || null,
    csFirstResponseTimeoutMinutes: parsePositiveInt(env.CS_FIRST_RESPONSE_TIMEOUT_MINUTES, 15)
  };
}
