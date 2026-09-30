import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';

const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
const database = new pg.Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000, query_timeout: 3000 });
try {
  await database.query('SELECT 1');
} catch {
  throw new Error('本机 PostgreSQL 连接失败，请检查 POSTGRES_PORT 与 DATABASE_URL 的一致性和端口占用');
} finally { await database.end(); }
const api = `http://127.0.0.1:${env.API_PORT || 3000}`;
const admin = `http://127.0.0.1:${env.ADMIN_PORT || 8080}`;
async function request(base, path) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, `${base}${path} 应返回 200`);
  return response;
}
const ready = await (await request(api, '/api/health/ready')).json();
assert.equal(ready.data.status, 'ready');
const direct = await (await request(api, '/api/admin/v1/platform')).json();
const proxied = await (await request(admin, '/api/admin/v1/platform')).json();
assert.equal(direct.data.businessReady, false);
assert.deepEqual(proxied.data, direct.data);
assert.equal(direct.data.contexts.length, 12);
// T002 起 catalog/identity-access/inventory/audit 为 partial，其余仍 planned
assert.ok(direct.data.contexts.every((context) => context.status === 'planned' || context.status === 'partial'));
// T002：公开 mini 商品接口可访问（无鉴权），迁移已执行
const miniProducts = await (await request(api, '/api/mini/v1/products')).json();
assert.ok(Array.isArray(miniProducts.data.items), 'mini 商品列表应返回分页结构');
// 未认证的管理接口应 401 而非 404/500
const guard = await fetch(`${api}/api/admin/v1/products`, { signal: AbortSignal.timeout(10000) });
assert.equal(guard.status, 401, '受保护接口未认证应返回 401');
const html = await (await request(admin, '/')).text();
assert.match(html, /id="app"/);
const asset = html.match(/src="([^"]+\.js)"/);
assert.ok(asset, '后台 HTML 应包含实际构建的脚本');
const js = await (await request(admin, asset[1])).text();
assert.ok(js.length > 1000, '实际 JS 资产应可读取');
assert.equal((await fetch(`${admin}/assets/does-not-exist.js`)).status, 404);
await request(api, '/api/health/openapi');
execFileSync('docker', ['compose', 'exec', '-T', 'worker', 'node', 'infra/docker/health-worker.cjs'], { stdio: 'pipe', timeout: 10000 });
console.log('Docker 冒烟通过：本机/容器 PostgreSQL、API 就绪、后台代理、构建资产、公开契约及 Worker 健康。');
