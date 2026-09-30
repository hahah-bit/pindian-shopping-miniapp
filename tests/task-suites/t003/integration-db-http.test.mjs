import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

async function resolveTestDatabase() {
  let envUrl = process.env.PINDIAN_TEST_DATABASE_URL;
  if (!envUrl) {
    const envFile = await readFile(join(root, '.env'), 'utf8').catch(() => '');
    const match = envFile.match(/^DATABASE_URL=(.+)$/m);
    if (match) envUrl = match[1].trim();
  }
  if (!envUrl) return null;
  const probe = new pg.Client({ connectionString: envUrl, connectionTimeoutMillis: 2000 });
  try { await probe.connect(); await probe.end(); } catch { return null; }
  const url = new URL(envUrl);
  url.pathname = '/pindian_t003_test';
  return { adminUrl: envUrl, testUrl: url.toString() };
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
  assert.ok(body.requestId);
  return body;
}

// ---------- 假微信服务（测试装置：模拟 code2session / stable_token / getuserphonenumber） ----------

function startFakeWx() {
  const state = {
    phoneFailMode: null, // null | 'invalid' | 'down'
    loginFailMode: null, // null | 'invalid' | 'down'
    phoneCalls: 0
  };
  const server = createHttpServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/sns/jscode2session') {
        const code = url.searchParams.get('js_code');
        if (state.loginFailMode === 'down') { response.end(JSON.stringify({ errcode: -1, errmsg: 'system busy' })); return; }
        if (state.loginFailMode === 'invalid' || !state.codes?.[code]) { response.end(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' })); return; }
        response.end(JSON.stringify({ openid: state.codes[code], unionid: null, session_key: 'fake-session-key' }));
        return;
      }
      if (url.pathname === '/cgi-bin/stable_token') {
        response.end(JSON.stringify({ access_token: 'fake-access-token', expires_in: 7200 }));
        return;
      }
      if (url.pathname === '/wxa/business/getuserphonenumber') {
        state.phoneCalls++;
        if (state.phoneFailMode === 'down') { response.end(JSON.stringify({ errcode: -1, errmsg: 'system busy' })); return; }
        const parsed = JSON.parse(body || '{}');
        if (state.phoneFailMode === 'invalid' || !state.phoneCodes?.[parsed.code]) { response.end(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' })); return; }
        response.end(JSON.stringify({ errcode: 0, phone_info: { phoneNumber: '+8613800001234', purePhoneNumber: '13800001234', countryCode: '86', watermark: { timestamp: Date.now(), appid: 'fake-appid' } } }));
        return;
      }
      response.statusCode = 404;
      response.end('{}');
    });
    state.codes = state.codes ?? { 'code-userA': 'openid-user-a', 'code-userB': 'openid-user-b', 'code-userC': 'openid-user-c' };
    state.phoneCodes = state.phoneCodes ?? { 'phone-code-ok': true };
    return state;
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, state, port: server.address().port })));
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

test('T003 集成：微信登录、资料/手机号、地址、后台用户管理全流程（真实 PG + 真实 HTTP + 假微信端点）', { timeout: 180_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const adminClient = new pg.Client({ connectionString: database.adminUrl });
  await adminClient.connect();
  await adminClient.query('DROP DATABASE IF EXISTS pindian_t003_test WITH (FORCE)');
  await adminClient.query('CREATE DATABASE pindian_t003_test');

  const migrateOut = await runNode(['backend/dist/bootstrap/migrate.js'], { DATABASE_URL: database.testUrl }, 'migrate-t003');
  assert.match(migrateOut, /已应用 0008/);

  const wx = await startFakeWx();
  const port = await unusedPort();
  const apiLogs = { text: '' };
  const api = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: database.testUrl,
      MEDIA_DIR: join(root, 'data', 'media-t003'),
      WX_APPID: 'fake-appid',
      WX_APP_SECRET: 'fake-secret',
      WX_API_BASE_URL: `http://127.0.0.1:${wx.port}`,
      USER_SESSION_TTL_MINUTES: '20160',
      PUBLIC_API_BASE_URL: `http://127.0.0.1:${port}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  api.stdout.on('data', (d) => { apiLogs.text += d; });
  api.stderr.on('data', (d) => { apiLogs.text += d; });
  const base = `http://127.0.0.1:${port}`;
  await waitForOk(`${base}/api/health/ready`, api, apiLogs.text);

  context.after(async () => {
    if (api.exitCode === null) api.kill();
    await new Promise((r) => { api.once('exit', r); setTimeout(r, 3000).unref(); });
    wx.server.close();
    await adminClient.query('DROP DATABASE IF EXISTS pindian_t003_test WITH (FORCE)').catch(() => {});
    await adminClient.end();
  });

  const jsonHeaders = { 'Content-Type': 'application/json' };

  // ---- G6：未配置路径由真实 main 验证（另测，见下方未配置用例） ----

  // ---- 登录：首次 + 重复（G2/G3） ----
  const loginA1 = await (await fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'code-userA' }) })).json();
  assert.equal(loginA1.data.isNewUser, true);
  assert.equal(loginA1.data.user.nickname, '微信用户');
  assert.ok(loginA1.data.token.length >= 32);
  const tokenA = loginA1.data.token;
  const authA = { ...jsonHeaders, Authorization: `Bearer ${tokenA}` };

  const loginA2 = await (await fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'code-userA' }) })).json();
  assert.equal(loginA2.data.isNewUser, false);
  assert.equal(loginA2.data.user.id, loginA1.data.user.id, '同一微信身份关联同一用户');

  // ---- me / 改昵称 ----
  const me1 = await (await fetch(`${base}/api/mini/v1/auth/me`, { headers: authA })).json();
  assert.equal(me1.data.hasPhone, false);
  const renamed = await (await fetch(`${base}/api/mini/v1/auth/profile`, { method: 'PATCH', headers: authA, body: JSON.stringify({ nickname: '拼单小明' }) })).json();
  assert.equal(renamed.data.nickname, '拼单小明');
  await expectHttpError(fetch(`${base}/api/mini/v1/auth/profile`, { method: 'PATCH', headers: authA, body: JSON.stringify({ nickname: '' }) }), 400, 'VALIDATION_FAILED');

  // ---- 无效 code / 假微信宕机（G5 类，真实 HTTP 适配器路径） ----
  wx.state.loginFailMode = 'invalid';
  await expectHttpError(fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'code-userB' }) }), 401, 'WECHAT_CODE_INVALID');
  wx.state.loginFailMode = 'down';
  await expectHttpError(fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'code-userB' }) }), 502, 'WECHAT_UNAVAILABLE');
  wx.state.loginFailMode = null;

  // ---- 手机号绑定：成功 / 失败不标记（G14） ----
  const bound = await (await fetch(`${base}/api/mini/v1/auth/phone`, { method: 'POST', headers: authA, body: JSON.stringify({ code: 'phone-code-ok' }) })).json();
  assert.equal(bound.data.hasPhone, true);
  assert.equal(bound.data.phoneMasked, '138****1234');
  wx.state.phoneFailMode = 'invalid';
  await expectHttpError(fetch(`${base}/api/mini/v1/auth/phone`, { method: 'POST', headers: authA, body: JSON.stringify({ code: 'bad-phone-code' }) }), 400, 'PHONE_CODE_INVALID');
  const meAfterFail = await (await fetch(`${base}/api/mini/v1/auth/me`, { headers: authA })).json();
  assert.equal(meAfterFail.data.phoneMasked, '138****1234', '失败不改变已绑定号码');
  wx.state.phoneFailMode = null;

  // ---- 地址 CRUD + 归属（G9/G10） ----
  const addressBody = { receiverName: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路 88 号 5 栋 201' };
  const createdA = await (await fetch(`${base}/api/mini/v1/addresses`, { method: 'POST', headers: authA, body: JSON.stringify(addressBody) })).json();
  assert.equal(createdA.data.isDefault, false, '首次新增不自动默认');
  const addressAId = createdA.data.id;
  await expectHttpError(fetch(`${base}/api/mini/v1/addresses`, { method: 'POST', headers: authA, body: JSON.stringify({ ...addressBody, phone: '123' }) }), 400, 'VALIDATION_FAILED');

  // 用户 B 登录并访问 A 的地址 → 404
  const loginB = await (await fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'code-userB' }) })).json();
  const authB = { ...jsonHeaders, Authorization: `Bearer ${loginB.data.token}` };
  await expectHttpError(fetch(`${base}/api/mini/v1/addresses/${addressAId}`, { headers: authB }), 404, 'NOT_FOUND');
  await expectHttpError(fetch(`${base}/api/mini/v1/addresses/${addressAId}`, { method: 'DELETE', headers: authB }), 404, 'NOT_FOUND');
  await expectHttpError(fetch(`${base}/api/mini/v1/addresses/${addressAId}/default`, { method: 'PUT', headers: authB }), 404, 'NOT_FOUND');

  // 编辑 + 设默认 + 幂等
  const updated = await (await fetch(`${base}/api/mini/v1/addresses/${addressAId}`, { method: 'PATCH', headers: authA, body: JSON.stringify({ ...addressBody, receiverName: '李四' }) })).json();
  assert.equal(updated.data.receiverName, '李四');
  const createdA2 = await (await fetch(`${base}/api/mini/v1/addresses`, { method: 'POST', headers: authA, body: JSON.stringify({ ...addressBody, detail: '第二条地址的详细信息' }) })).json();
  const setDefault1 = await (await fetch(`${base}/api/mini/v1/addresses/${addressAId}/default`, { method: 'PUT', headers: authA })).json();
  assert.equal(setDefault1.data.items.find((i) => i.id === addressAId).isDefault, true);
  const setDefault2 = await (await fetch(`${base}/api/mini/v1/addresses/${createdA2.data.id}/default`, { method: 'PUT', headers: authA })).json();
  const afterDefault = await (await fetch(`${base}/api/mini/v1/addresses`, { headers: authA })).json();
  assert.equal(afterDefault.data.items.filter((i) => i.isDefault).length, 1, '默认地址唯一');
  assert.equal(afterDefault.data.items.find((i) => i.id === createdA2.data.id).isDefault, true, '后设默认生效');

  // 并发设默认：两个并发 PUT，终态唯一（G12）
  const [c1, c2] = await Promise.all([
    fetch(`${base}/api/mini/v1/addresses/${addressAId}/default`, { method: 'PUT', headers: authA }),
    fetch(`${base}/api/mini/v1/addresses/${createdA2.data.id}/default`, { method: 'PUT', headers: authA })
  ]);
  assert.equal(c1.status, 200);
  assert.equal(c2.status, 200);
  const afterConcurrent = await (await fetch(`${base}/api/mini/v1/addresses`, { headers: authA })).json();
  assert.equal(afterConcurrent.data.items.filter((i) => i.isDefault).length, 1, '并发设默认后仍唯一');

  // 删除默认 → 无默认态（G13）
  await fetch(`${base}/api/mini/v1/addresses/${createdA2.data.id}`, { method: 'DELETE', headers: authA });
  const afterDelete = await (await fetch(`${base}/api/mini/v1/addresses`, { headers: authA })).json();
  assert.equal(afterDelete.data.items.filter((i) => i.isDefault).length, 0, '删除默认后不自动补');

  // ---- 会话过期语义：登出后旧 token 失效（G8） ----
  const loginC = await (await fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'code-userC' }) })).json();
  const authC = { ...jsonHeaders, Authorization: `Bearer ${loginC.data.token}` };
  await fetch(`${base}/api/mini/v1/auth/logout`, { method: 'POST', headers: authC });
  await expectHttpError(fetch(`${base}/api/mini/v1/auth/me`, { headers: authC }), 401, 'UNAUTHENTICATED');

  // ---- admin token 不能访问 user 域（realm 隔离） ----
  await runNode(['backend/dist/bootstrap/create-admin.js'], { DATABASE_URL: database.testUrl, ADMIN_INITIAL_USERNAME: 'root', ADMIN_INITIAL_PASSWORD: 't003-admin-pass' }, 'create-admin-t003');
  const adminLogin = await (await fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: 'root', password: 't003-admin-pass' }) })).json();
  const authAdmin = { ...jsonHeaders, Authorization: `Bearer ${adminLogin.data.token}` };
  await expectHttpError(fetch(`${base}/api/mini/v1/auth/me`, { headers: authAdmin }), 401, 'UNAUTHENTICATED');

  // ---- 后台用户管理（G15-G18） ----
  const userListResponse = await fetch(`${base}/api/admin/v1/users`, { headers: authAdmin });
  if (!userListResponse.ok) console.error('[debug] admin users status', userListResponse.status, await userListResponse.text());
  const userList = await userListResponse.json();
  assert.equal(userList.data.total, 3, '三个已登录用户（A/B/C）');
  assert.ok(!JSON.stringify(userList).includes('13800001234'), '列表脱敏');
  const targetUser = userList.data.items.find((u) => u.nickname === '拼单小明');
  assert.equal(targetUser.phoneMasked, '138****1234');

  const detail = await (await fetch(`${base}/api/admin/v1/users/${targetUser.id}`, { headers: authAdmin })).json();
  assert.ok(!JSON.stringify(detail).includes('13800001234'));

  const revealed = await (await fetch(`${base}/api/admin/v1/users/${targetUser.id}/phone`, { headers: authAdmin })).json();
  assert.equal(revealed.data.phone, '13800001234', '显式端点返回原文');
  const auditClient = new pg.Client({ connectionString: database.testUrl });
  await auditClient.connect();
  const auditRows = await auditClient.query(`SELECT action, detail FROM admin_operation_logs WHERE action = 'user.phone_revealed' ORDER BY created_at DESC LIMIT 1`);
  await auditClient.end();
  assert.equal(auditRows.rows.length, 1, '审计已记录');
  assert.ok(!JSON.stringify(auditRows.rows[0]).includes('13800001234'), '审计不含原文');

  // 禁用：会话立即失效 + 登录 403（G18）
  await fetch(`${base}/api/admin/v1/users/${targetUser.id}/disable`, { method: 'POST', headers: authAdmin });
  await expectHttpError(fetch(`${base}/api/mini/v1/auth/me`, { headers: authA }), 401, 'UNAUTHENTICATED');
  wx.state.loginFailMode = null;
  const disabledLogin = await fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'code-userA' }) });
  assert.equal(disabledLogin.status, 403);
  assert.equal((await disabledLogin.json()).code, 'USER_DISABLED');
  await fetch(`${base}/api/admin/v1/users/${targetUser.id}/enable`, { method: 'POST', headers: authAdmin });
  const reLogin = await (await fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ code: 'code-userA' }) })).json();
  assert.equal(reLogin.data.isNewUser, false, '启用后重新登录关联同一用户');
  authA.Authorization = `Bearer ${reLogin.data.token}`;

  // ---- 服务重启数据保留（G19）：重启 API（不删库） ----
  api.kill();
  await new Promise((r) => { api.once('exit', r); setTimeout(r, 3000).unref(); });
  const api2 = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: database.testUrl, MEDIA_DIR: join(root, 'data', 'media-t003'), WX_APPID: 'fake-appid', WX_APP_SECRET: 'fake-secret', WX_API_BASE_URL: `http://127.0.0.1:${wx.port}`, PUBLIC_API_BASE_URL: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  api2.stdout.on('data', (d) => { apiLogs.text += d; });
  api2.stderr.on('data', (d) => { apiLogs.text += d; });
  context.after(async () => {
    if (api2.exitCode === null) api2.kill();
    await new Promise((r) => { api2.once('exit', r); setTimeout(r, 3000).unref(); });
  });
  await waitForOk(`${base}/api/health/ready`, api2, apiLogs.text);
  const afterRestart = await (await fetch(`${base}/api/mini/v1/auth/me`, { headers: authB })).json();
  assert.equal(afterRestart.data.nickname, '微信用户', '重启后用户与会话保留');
  const addressesAfterRestart = await (await fetch(`${base}/api/mini/v1/addresses`, { headers: authA })).json();
  assert.ok(addressesAfterRestart.data.items.length >= 1, '重启后地址保留');

  // ---- T002 回归：mini 商品接口仍正常（此库无商品，结构校验） ----
  const miniProducts = await (await fetch(`${base}/api/mini/v1/products`)).json();
  assert.deepEqual(miniProducts.data.items, []);
});

test('真实 main + 无微信凭据：登录返回 WECHAT_NOT_CONFIGURED 且不产生数据（G6/AC02）', { timeout: 60_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const adminClient = new pg.Client({ connectionString: database.adminUrl });
  await adminClient.connect();
  await adminClient.query('DROP DATABASE IF EXISTS pindian_t003_nc_test WITH (FORCE)');
  await adminClient.query('CREATE DATABASE pindian_t003_nc_test');
  context.after(async () => {
    await adminClient.query('DROP DATABASE IF EXISTS pindian_t003_nc_test WITH (FORCE)').catch(() => {});
    await adminClient.end();
  });
  const ncTestUrl = database.testUrl.replace('/pindian_t003_test', '/pindian_t003_nc_test');
  await runNode(['backend/dist/bootstrap/migrate.js'], { DATABASE_URL: ncTestUrl }, 'migrate-nc');
  const port = await unusedPort();
  const apiLogs = { text: '' };
  const api = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: ncTestUrl, MEDIA_DIR: join(root, 'data', 'media-t003-nc') },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  api.stdout.on('data', (d) => { apiLogs.text += d; });
  api.stderr.on('data', (d) => { apiLogs.text += d; });
  context.after(async () => {
    if (api.exitCode === null) api.kill();
    await new Promise((r) => { api.once('exit', r); setTimeout(r, 3000).unref(); });
  });
  await waitForOk(`http://127.0.0.1:${port}/api/health/ready`, api, apiLogs.text);
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/api/mini/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'any-code' }) });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'WECHAT_NOT_CONFIGURED');
  assert.match(body.message, /未配置/);
  const ncClient = new pg.Client({ connectionString: ncTestUrl });
  await ncClient.connect();
  const count = await ncClient.query('SELECT COUNT(*)::int AS c FROM users');
  await ncClient.end();
  assert.equal(count.rows[0].c, 0, '未配置不产生用户');
});
