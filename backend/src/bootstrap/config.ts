export interface RuntimeConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  mediaDir: string;
  publicApiBaseUrl: string;
  adminSessionTtlMinutes: number;
  userSessionTtlMinutes: number;
  wxAppid: string | null;
  wxAppSecret: string | null;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`配置 ${value} 必须为正整数`);
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
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
    port,
    databaseUrl: env.DATABASE_URL,
    corsOrigins,
    mediaDir: env.MEDIA_DIR ?? 'data/media',
    publicApiBaseUrl,
    adminSessionTtlMinutes: parsePositiveInt(env.ADMIN_SESSION_TTL_MINUTES, 720),
    userSessionTtlMinutes: parsePositiveInt(env.USER_SESSION_TTL_MINUTES, 20160),
    wxAppid: env.WX_APPID?.trim() || null,
    wxAppSecret: env.WX_APP_SECRET?.trim() || null
  };
}
