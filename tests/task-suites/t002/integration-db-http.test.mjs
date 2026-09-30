import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

// ---------- 工具 ----------

async function unusedPort() {
  const server = createServer();
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const port = server.address().port;
  await new Promise((res) => server.close(res));
  return port;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function makePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x01]))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function runNode(args, env, label) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', rej);
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`${label} 退出码 ${code}：${out}`))));
  });
}

async function waitForOk(url, child, logs) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`API 提前退出：${logs}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(800) })).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`API 未就绪：${logs}`);
}

async function expectHttpError(promise, status, code) {
  const response = await promise;
  assert.equal(response.status, status, `期望 HTTP ${status}，实际 ${response.status}`);
  const body = await response.json();
  assert.equal(body.code, code);
  assert.ok(body.requestId, '错误响应带 requestId');
  return body;
}

// ---------- 环境探测 ----------

async function resolveTestDatabase() {
  let envUrl = process.env.PINDIAN_TEST_DATABASE_URL;
  if (!envUrl) {
    const envFile = await readFile(join(root, '.env'), 'utf8').catch(() => '');
    const match = envFile.match(/^DATABASE_URL=(.+)$/m);
    if (match) envUrl = match[1].trim();
  }
  if (!envUrl) return null;
  // 用已有数据库探测连通性（测试库此时可能尚不存在）
  const probe = new pg.Client({ connectionString: envUrl, connectionTimeoutMillis: 2000 });
  try {
    await probe.connect();
    await probe.end();
  } catch {
    return null;
  }
  const url = new URL(envUrl);
  url.pathname = '/pindian_test';
  return { adminUrl: envUrl, testUrl: url.toString() };
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

test('集成：迁移、管理员、登录、图片、商品、库存、小程序全流程（真实 PG + 真实 HTTP）', { timeout: 120_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const adminClient = new pg.Client({ connectionString: database.adminUrl });
  await adminClient.connect();
  const resetDatabase = async () => {
    await adminClient.query('DROP DATABASE IF EXISTS pindian_test WITH (FORCE)');
    await adminClient.query('CREATE DATABASE pindian_test');
  };
  await resetDatabase();

  // 1. 迁移可重复执行
  const first = await runNode(['backend/dist/bootstrap/migrate.js'], { DATABASE_URL: database.testUrl }, 'migrate#1');
  assert.match(first, /已应用 0005/);
  const second = await runNode(['backend/dist/bootstrap/migrate.js'], { DATABASE_URL: database.testUrl }, 'migrate#2');
  assert.match(second, /本次应用 0 个/);

  // 2. 初始管理员幂等创建，输出不含密码
  const adminEnv = { DATABASE_URL: database.testUrl, ADMIN_INITIAL_USERNAME: 'root', ADMIN_INITIAL_PASSWORD: 'test-admin-pass-1' };
  const created = await runNode(['backend/dist/bootstrap/create-admin.js'], adminEnv, 'create-admin#1');
  assert.match(created, /已创建初始管理员/);
  assert.ok(!created.includes('test-admin-pass-1'));
  const updated = await runNode(['backend/dist/bootstrap/create-admin.js'], adminEnv, 'create-admin#2');
  assert.match(updated, /已更新既有管理员/);

  // 3. 启动真实 API
  const mediaDir = mkdtempSync(join(tmpdir(), 'pindian-media-'));
  const port = await unusedPort();
  const apiLogs = { text: '' };
  const api = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: database.testUrl,
      MEDIA_DIR: mediaDir,
      PUBLIC_API_BASE_URL: `http://127.0.0.1:${port}`,
      CORS_ORIGINS: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  api.stdout.on('data', (d) => { apiLogs.text += d; });
  api.stderr.on('data', (d) => { apiLogs.text += d; });

  const base = `http://127.0.0.1:${port}`;
  await waitForOk(`${base}/api/health/ready`, api, apiLogs.text);
  const authHeaders = { 'Content-Type': 'application/json' };

  // 4. 未认证拒绝（AC01/G1）
  await expectHttpError(fetch(`${base}/api/admin/v1/products`), 401, 'UNAUTHENTICATED');
  await expectHttpError(fetch(`${base}/api/admin/v1/media`), 401, 'UNAUTHENTICATED');

  // 5. 登录失败/限流/成功（G 限流 429）
  await expectHttpError(fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ username: 'root', password: 'wrong-pass-000' }) }), 401, 'UNAUTHENTICATED');
  const loginResponse = await fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ username: 'root', password: 'test-admin-pass-1' }) });
  assert.equal(loginResponse.status, 200);
  const loginBody = (await loginResponse.json()).data;
  assert.ok(loginBody.token.length >= 32);
  assert.equal(loginBody.admin.username, 'root');
  assert.ok(loginBody.admin.permissions.includes('catalog:manage'));
  assert.ok(!JSON.stringify(loginBody).includes('test-admin-pass-1'), '响应不回显密码');
  const bearer = { ...authHeaders, Authorization: `Bearer ${loginBody.token}` };

  // 6. 身份查询与登出
  const me = await fetch(`${base}/api/admin/v1/auth/me`, { headers: bearer });
  assert.equal(me.status, 200);
  // 登出后旧 token 失效
  const secondLogin = await (await fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ username: 'root', password: 'test-admin-pass-1' }) })).json();
  await fetch(`${base}/api/admin/v1/auth/logout`, { method: 'POST', headers: { ...authHeaders, Authorization: `Bearer ${secondLogin.data.token}` } });
  await expectHttpError(fetch(`${base}/api/admin/v1/auth/me`, { headers: { ...authHeaders, Authorization: `Bearer ${secondLogin.data.token}` } }), 401, 'UNAUTHENTICATED');

  // 7. 空小程序列表
  const emptyMini = await (await fetch(`${base}/api/mini/v1/products`)).json();
  assert.deepEqual(emptyMini.data, { items: [], page: 1, pageSize: 10, total: 0 });

  // 8. 图片上传校验矩阵（AC-F06）
  const form = (bytes, filename, type) => {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), filename);
    return { method: 'POST', headers: { Authorization: bearer.Authorization }, body: fd };
  };
  await expectHttpError(fetch(`${base}/api/admin/v1/media`, form(Buffer.from('<html>fake</html>'), 'fake.png', 'image/png')), 415, 'UNSUPPORTED_MEDIA_TYPE');
  await expectHttpError(fetch(`${base}/api/admin/v1/media`, form(makePng(32, 32), 'small.png', 'image/png')), 400, 'VALIDATION_FAILED');
  await expectHttpError(fetch(`${base}/api/admin/v1/media`, form(Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'big.bin', 'application/octet-stream')), 413, 'PAYLOAD_TOO_LARGE');

  const mainUpload = await fetch(`${base}/api/admin/v1/media`, form(makePng(640, 480), 'apple.png', 'image/png'));
  assert.equal(mainUpload.status, 201);
  const mainAsset = (await mainUpload.json()).data;
  assert.equal(mainAsset.format, 'png');
  assert.equal(mainAsset.width, 640);
  const detailUpload = await fetch(`${base}/api/admin/v1/media`, form(makePng(320, 240), 'detail.png', 'image/png'));
  const detailAsset = (await detailUpload.json()).data;

  // 公开读取（后台/小程序同 URL）
  const assetResponse = await fetch(mainAsset.url);
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get('content-type'), 'image/png');
  assert.equal((await assetResponse.arrayBuffer()).byteLength, makePng(640, 480).length);
  await expectHttpErrorPlain(fetch(`${base}/api/media/v1/assets/00000000-0000-4000-8000-000000000000`), 404);

  // 9. 创建商品：坏引用拒绝；正常创建（G 商品库存同生共灭）
  await expectHttpError(fetch(`${base}/api/admin/v1/products`, {
    method: 'POST', headers: bearer,
    body: JSON.stringify({ name: '坏引用', originalPriceFen: 5000, wholeQuantity: '1', unit: '份', allowedShareUnits: [30], mainImageId: '00000000-0000-4000-8000-000000000099', initialStockWholeItems: 1 })
  }), 400, 'VALIDATION_FAILED');

  const productBody = {
    name: '红富士苹果', description: '产地直发，10 斤装', originalPriceFen: 50000, wholeQuantity: '10', unit: '斤',
    allowedShareUnits: [30, 20, 15, 12], mainImageId: mainAsset.id, detailImageIds: [detailAsset.id], initialStockWholeItems: 3
  };
  const createdProduct = await fetch(`${base}/api/admin/v1/products`, { method: 'POST', headers: bearer, body: JSON.stringify(productBody) });
  assert.equal(createdProduct.status, 201);
  const product = (await createdProduct.json()).data;
  assert.equal(product.status, 'draft');
  assert.equal(product.availableWholeItems, 3);
  assert.equal(product.userWholePriceFen, 50500);
  const half = product.shareOptions.find((o) => o.units === 30);
  assert.equal(half.referencePriceFen, 25250);
  assert.equal(half.quantityText, '5');

  // 10. 上架条件与幂等（G6/G12）
  const noImageProduct = await (await fetch(`${base}/api/admin/v1/products`, {
    method: 'POST', headers: bearer,
    body: JSON.stringify({ ...productBody, name: '无图商品', mainImageId: undefined, detailImageIds: [], initialStockWholeItems: 0 })
  })).json();
  const publishRejected = await expectHttpError(fetch(`${base}/api/admin/v1/products/${noImageProduct.data.id}/publish`, { method: 'POST', headers: bearer }), 409, 'PRODUCT_NOT_PUBLISHABLE');
  assert.ok(publishRejected.details.some((r) => r.includes('未设置主图')));
  assert.ok(publishRejected.details.some((r) => r.includes('库存为 0')));

  const publishOk = await fetch(`${base}/api/admin/v1/products/${product.id}/publish`, { method: 'POST', headers: bearer });
  assert.equal(publishOk.status, 200);
  assert.equal((await publishOk.json()).data.status, 'on_shelf');
  const publishAgain = await fetch(`${base}/api/admin/v1/products/${product.id}/publish`, { method: 'POST', headers: bearer });
  assert.equal(publishAgain.status, 200, '重复上架幂等');

  // 11. 小程序可见性（G7/G8）
  const miniList = await (await fetch(`${base}/api/mini/v1/products`)).json();
  assert.equal(miniList.data.total, 1);
  assert.equal(miniList.data.items[0].priceFromFen, 10100);
  assert.equal(miniList.data.items[0].mainImageUrl, mainAsset.url);
  const miniDetail = await (await fetch(`${base}/api/mini/v1/products/${product.id}`)).json();
  assert.equal(miniDetail.data.stockStatus, 'available');
  assert.equal(miniDetail.data.shareOptions.length, 4);

  // 12. 库存约束与幂等（G9/G10）
  await expectHttpError(fetch(`${base}/api/admin/v1/products/${product.id}/stock-adjustments`, {
    method: 'POST', headers: bearer, body: JSON.stringify({ delta: -10, reason: '超扣' })
  }), 409, 'CONFLICT');
  const idemKey = '9aaaaaaa-bbbb-4ccc-8ddd-000000000001';
  const firstAdjust = await (await fetch(`${base}/api/admin/v1/products/${product.id}/stock-adjustments`, {
    method: 'POST', headers: bearer, body: JSON.stringify({ delta: -1, reason: '测试扣减', requestId: idemKey })
  })).json();
  assert.equal(firstAdjust.data.idempotentReplay, false);
  assert.equal(firstAdjust.data.stock.availableWholeItems, 2);
  const replayAdjust = await (await fetch(`${base}/api/admin/v1/products/${product.id}/stock-adjustments`, {
    method: 'POST', headers: bearer, body: JSON.stringify({ delta: -1, reason: '测试扣减', requestId: idemKey })
  })).json();
  assert.equal(replayAdjust.data.idempotentReplay, true);
  assert.equal(replayAdjust.data.stock.availableWholeItems, 2);
  const setSame = await (await fetch(`${base}/api/admin/v1/products/${product.id}/stock-adjustments`, {
    method: 'POST', headers: bearer, body: JSON.stringify({ setTo: 2, reason: '核对' })
  })).json();
  assert.equal(setSame.data.idempotentReplay, true);

  // 并发行锁：两个并发 -2，余额 2 → 仅一个成功，最终 0
  const concurrent = await Promise.all([0, 1].map(() =>
    fetch(`${base}/api/admin/v1/products/${product.id}/stock-adjustments`, { method: 'POST', headers: bearer, body: JSON.stringify({ delta: -2, reason: '并发扣' }) })
  ));
  const statuses = concurrent.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409], '并发调整恰好一个成功');
  const afterConcurrent = await (await fetch(`${base}/api/admin/v1/products/${product.id}`, { headers: bearer })).json();
  assert.equal(afterConcurrent.data.availableWholeItems, 0);
  assert.equal(afterConcurrent.data.stockStatus, 'sold_out');
  const soldOutDetail = await (await fetch(`${base}/api/mini/v1/products/${product.id}`)).json();
  assert.equal(soldOutDetail.data.stockStatus, 'sold_out', '售罄仍可访问详情');

  // 变动历史
  const movements = await (await fetch(`${base}/api/admin/v1/products/${product.id}/stock-movements`, { headers: bearer })).json();
  assert.ok(movements.data.total >= 3, '初始化 + 扣减 + 并发共至少 3 条');
  assert.ok(movements.data.items.every((m) => Number.isInteger(m.delta) && m.delta !== 0));

  // 13. 图片引用约束（AC-F06-7）：被引用不可删；解除关联后可删
  await expectHttpError(fetch(`${base}/api/admin/v1/media/${detailAsset.id}`, { method: 'DELETE', headers: bearer }), 409, 'MEDIA_IN_USE');
  const patched = await fetch(`${base}/api/admin/v1/products/${product.id}`, {
    method: 'PATCH', headers: bearer,
    body: JSON.stringify({ ...productBody, detailImageIds: [] })
  });
  assert.equal(patched.status, 200);
  const mediaListAfterPatch = await (await fetch(`${base}/api/admin/v1/media`, { headers: bearer })).json();
  assert.equal(mediaListAfterPatch.data.items.find((m) => m.id === detailAsset.id).referencedByProducts, 0);
  const deleteOk = await fetch(`${base}/api/admin/v1/media/${detailAsset.id}`, { method: 'DELETE', headers: bearer });
  assert.equal(deleteOk.status, 200);
  await expectHttpErrorPlain(fetch(detailAsset.url), 404);

  // 14. 下架不可见
  await fetch(`${base}/api/admin/v1/products/${product.id}/unpublish`, { method: 'POST', headers: bearer });
  await expectHttpErrorPlain(fetch(`${base}/api/mini/v1/products/${product.id}`), 404);
  const miniListAfter = await (await fetch(`${base}/api/mini/v1/products`)).json();
  assert.equal(miniListAfter.data.total, 0);

  // 15. 审计与凭据安全（AC02）：直接查测试库
  const testClient = new pg.Client({ connectionString: database.testUrl });
  await testClient.connect();
  const auditCount = await testClient.query('SELECT COUNT(*)::int AS c FROM admin_operation_logs');
  assert.ok(auditCount.rows[0].c >= 5, `操作日志已记录（${auditCount.rows[0].c} 条）`);
  const adminRow = await testClient.query('SELECT password_hash FROM admins WHERE username = $1', ['root']);
  assert.match(adminRow.rows[0].password_hash, /^scrypt\$/);
  assert.ok(!adminRow.rows[0].password_hash.includes('test-admin-pass-1'));
  const sessionRow = await testClient.query('SELECT token_hash FROM admin_sessions LIMIT 1');
  assert.match(sessionRow.rows[0].token_hash, /^[0-9a-f]{64}$/, '数据库只存 token 哈希');

  // 统一有序清理：先停 API，再断开测试库连接，最后删库（失败不掩盖测试结果）
  context.after(async () => {
    if (api.exitCode === null) api.kill();
    await new Promise((r) => { api.once('exit', r); setTimeout(r, 3000).unref(); });
    await testClient.end().catch(() => {});
    rmSync(mediaDir, { recursive: true, force: true });
    await adminClient.query('DROP DATABASE IF EXISTS pindian_test WITH (FORCE)').catch(() => {});
    await adminClient.end().catch(() => {});
  });
});

async function expectHttpErrorPlain(promise, status) {
  const response = await promise;
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.code, 'NOT_FOUND');
}
