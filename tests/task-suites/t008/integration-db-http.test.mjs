import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const dist = (rel) => pathToFileURL(join(root, 'backend/dist', rel)).href;

async function unusedPort() {
  const s = createServer();
  await new Promise((res, rej) => { s.once('error', rej); s.listen(0, '127.0.0.1', res); });
  const port = s.address().port;
  await new Promise((res) => s.close(res));
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
  url.pathname = '/pindian_t008_test';
  return { adminUrl: envUrl, testUrl: url.toString() };
}

async function waitForOk(url, child, logs) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`API 提前退出：${logs}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(800) })).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`API 未就绪：${logs}`);
}

async function expectHttpError(promise, status, code) {
  const response = await promise;
  assert.equal(response.status, status, `期望 HTTP ${status} 实际 ${response.status}`);
  const body = await response.json();
  assert.equal(body.code, code);
  return body;
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

test('T008 集成：会话发起/留言、并发接入恰一人、消息幂等与补取、转工单、售后协调退款、越权（真实 PG+HTTP+生产装配）', { timeout: 300_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t008_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t008_test');
  context.after(async () => { await admin.end(); });

  const migrateOut = await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`迁移失败：${out}`))));
  });
  assert.match(migrateOut, /已应用 0018/);

  const port = await unusedPort();
  const mediaDir = mkdtempSync(join(tmpdir(), 'pindian-t008-'));
  const logs = { text: '' };
  const api = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: database.testUrl, MEDIA_DIR: mediaDir, PUBLIC_API_BASE_URL: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  api.stdout.on('data', (d) => { logs.text += d; process.stdout.write('[api] ' + d); });
  api.stderr.on('data', (d) => { logs.text += d; process.stdout.write('[api-err] ' + d); });
  const base = `http://127.0.0.1:${port}`;
  await waitForOk(`${base}/api/health/ready`, api, logs.text);
  context.after(async () => {
    if (api.exitCode === null) api.kill();
    await new Promise((r) => { api.once('exit', r); setTimeout(r, 3000).unref(); });
    rmSync(mediaDir, { recursive: true, force: true });
    if (process.env.PINDIAN_KEEP_TEST_DB !== '1') {
      await admin.query('DROP DATABASE IF EXISTS pindian_t008_test WITH (FORCE)').catch(() => {});
    }
  });

  // ---- 种子：用户 + 支付订单（供售后退款协调） ----
  const testDb = new pg.Client({ connectionString: database.testUrl });
  await testDb.connect();
  context.after(async () => { await testDb.end().catch(() => {}); });
  const USER_A = 'aaaaaaaa-8888-4888-8888-000000000001';
  const USER_B = 'aaaaaaaa-8888-4888-8888-000000000002';
  const PRODUCT = 'cccccccc-8888-4888-8888-000000000003';
  const GROUP = 'eeeeeeee-8888-4888-8888-000000000004';
  const SNAPSHOT = JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' });
  const auth = {};
  for (const [key, id] of Object.entries({ ua: USER_A, ub: USER_B })) {
    await testDb.query(`INSERT INTO users (id, nickname, status) VALUES ($1, $2, 'active')`, [id, `用户${key}`]);
    const token = `tok-${key}-${Date.now()}`;
    await testDb.query(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [id, createHash('sha256').update(token).digest('hex')]);
    auth[key] = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }
  await testDb.query(
    `INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status, group_deadline_hours)
     VALUES ($1, '客服测试苹果', 50000, 10, '斤', ARRAY[30,20,15,12], 'on_shelf', 24)`,
    [PRODUCT]
  );
  await testDb.query(
    `INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units, paid_amount_fen, paid_goods_amount_fen)
     VALUES ($1, $2, $3, now() + interval '24 hours', 'success', 60, 50499, 50166)`,
    [GROUP, PRODUCT, SNAPSHOT]
  );
  const orderId = randomUUID();
  await testDb.query(
    `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text, address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at)
     VALUES ($1, 'PO-T008-1', $2, $3, $4, 30, 'paid', 25250, 25000, 250, false, 50000, '斤', '10', '10', '收货人', '13800001230', '广东省', '深圳市', '南山区', '客服测试地址', $5, now() + interval '24 hours', now())`,
    [orderId, USER_A, PRODUCT, GROUP, randomUUID()]
  );
  await testDb.query(
    `INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, prepay_id, channel_transaction_id, applied_result)
     VALUES ($1, $2, $3, 50500, 'succeeded', $4, 'prep-t008', 'wx-tx-t008', 'applied')`,
    [randomUUID(), orderId, USER_A, `T008-${orderId}`]
  );

  // ---- 管理员（客服） ----
  await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/create-admin.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl, ADMIN_INITIAL_USERNAME: 'agent1', ADMIN_INITIAL_PASSWORD: 'agent1-pass' }, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error('create-agent 失败'))));
  });
  const agentLogin = await (await fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'agent1', password: 'agent1-pass' }) })).json();
  const agentAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${agentLogin.data.token}` };

  // ================= 场景 1：发起会话 + 留言（无客服接入） =================
  const create1 = await (await fetch(`${base}/api/mini/v1/conversations`, { method: 'POST', headers: auth.ua })).json();
  assert.equal(create1.data.conversation.status, 'queued');
  const cid = create1.data.conversation.id;
  // 幂等恢复
  const create2 = await (await fetch(`${base}/api/mini/v1/conversations`, { method: 'POST', headers: auth.ua })).json();
  assert.equal(create2.data.conversation.id, cid);
  // queued 也能留言（离线留言语义）
  const send1 = await (await fetch(`${base}/api/mini/v1/conversations/${cid}/messages`, { method: 'POST', headers: auth.ua, body: JSON.stringify({ clientMessageId: 'cm-1', kind: 'text', content: { text: '请问发货多久？' } }) })).json();
  assert.equal(send1.data.message.seq, 1);
  // 越权：ub 用 ua 的会话
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/${cid}/messages`, { headers: auth.ub }), 404, 'NOT_FOUND');
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/${cid}/messages`, { method: 'POST', headers: auth.ub, body: JSON.stringify({ clientMessageId: 'cm-x', kind: 'text', content: { text: 'x' } }) }), 404, 'NOT_FOUND');
  // 未登录 401
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/current`), 401, 'UNAUTHENTICATED');

  // ================= 场景 2：并发接入恰一人 =================
  const [accept1, accept2] = await Promise.all([
    fetch(`${base}/api/admin/v1/cs/conversations/${cid}/accept`, { method: 'POST', headers: agentAuth }),
    fetch(`${base}/api/admin/v1/cs/conversations/${cid}/accept`, { method: 'POST', headers: agentAuth })
  ]);
  const accepted = [accept1.status, accept2.status].sort();
  assert.deepEqual(accepted, [200, 409], '并发接入恰一人成功');

  // ================= 场景 3：消息幂等/seq/补取 =================
  const reply = await (await fetch(`${base}/api/admin/v1/cs/conversations/${cid}/messages`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ clientMessageId: 'ag-1', kind: 'text', content: { text: '您好，24 小时内发货' } }) })).json();
  assert.equal(reply.data.message.seq, 2);
  // 重复投递同 clientMessageId → 幂等
  const dup = await (await fetch(`${base}/api/mini/v1/conversations/${cid}/messages`, { method: 'POST', headers: auth.ua, body: JSON.stringify({ clientMessageId: 'cm-1', kind: 'text', content: { text: '请问发货多久？' } }) })).json();
  assert.equal(dup.data.message.seq, 1, '重复 clientMessageId 幂等返回原消息');
  assert.equal(dup.data.duplicated, true);
  // 客服备注（internal）
  const note = await (await fetch(`${base}/api/admin/v1/cs/conversations/${cid}/messages`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ clientMessageId: 'ag-note', kind: 'note', content: { text: '内部备注：老客户' } }) })).json();
  assert.equal(note.data.message.internal, true);
  // 用户补取：不含 internal 备注；客服补取：含
  const userCatchUp = await (await fetch(`${base}/api/mini/v1/conversations/${cid}/messages?afterSeq=0`, { headers: auth.ua })).json();
  assert.equal(userCatchUp.data.messages.some((m) => m.kind === 'note'), false, '用户不可见内部备注');
  const agentCatchUp = await (await fetch(`${base}/api/admin/v1/cs/conversations/${cid}/messages?afterSeq=0`, { headers: agentAuth })).json();
  assert.equal(agentCatchUp.data.messages.some((m) => m.kind === 'note'), true, '客服可见内部备注');
  const afterSeq1 = await (await fetch(`${base}/api/mini/v1/conversations/${cid}/messages?afterSeq=1`, { headers: auth.ua })).json();
  assert.ok(afterSeq1.data.messages.every((m) => m.seq > 1), 'afterSeq=1 只返回增量');

  // ================= 场景 4：卡片消息（可见性） =================
  const cardMsg = await (await fetch(`${base}/api/mini/v1/conversations/${cid}/messages`, { method: 'POST', headers: auth.ua, body: JSON.stringify({ clientMessageId: 'cm-card', kind: 'card', content: { cardKind: 'order', cardRefId: orderId } }) })).json();
  assert.equal(cardMsg.data.message.kind, 'card');
  // 他人订单卡片 → 400（投影校验拒绝）
  await expectHttpError(fetch(`${base}/api/mini/v1/cards/order/${orderId}`, { headers: auth.ub }), 404, 'NOT_FOUND');
  const cardView = await (await fetch(`${base}/api/mini/v1/cards/order/${orderId}`, { headers: auth.ua })).json();
  assert.equal(cardView.data.order.orderNo, 'PO-T008-1');

  // ================= 场景 5：转工单 → 会话 converted → 消息拒发 =================
  const converted = await (await fetch(`${base}/api/admin/v1/cs/conversations/${cid}/convert-ticket`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ type: 'shipment_issue', title: '发货问题', description: '用户咨询发货进度并要求跟进' }) })).json();
  assert.equal(converted.data.ticket.status, 'open');
  const ticketId = converted.data.ticket.id;
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/${cid}/messages`, { method: 'POST', headers: auth.ua, body: JSON.stringify({ clientMessageId: 'cm-after', kind: 'text', content: { text: 'x' } }) }), 409, 'CONVERSATION_ENDED');

  // ================= 场景 6：售后受理 + 协调退款 + 重复退款拒绝 =================
  await expectHttpError(fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/refund`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ orderId }) }), 409, 'TICKET_STATE_CONFLICT', 'open 状态不能直接退款');
  const acceptTicket = await (await fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/accept`, { method: 'POST', headers: agentAuth })).json();
  assert.equal(acceptTicket.data.ticket.status, 'processing');
  const refund = await (await fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/refund`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ orderId }) })).json();
  assert.ok(refund.data.refundId);
  // 重复退款：支付域额度校验拒绝（该支付单已有退款单）→ 409 REFUND_EXCEED_LIMIT，工单无新 action
  await expectHttpError(fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/refund`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ orderId }) }), 409, 'REFUND_EXCEED_LIMIT');
  const refundActionCount = (await testDb.query(`SELECT COUNT(*)::int AS c FROM after_sales_ticket_actions WHERE ticket_id = $1 AND action = 'request_refund'`, [ticketId])).rows[0].c;
  assert.equal(refundActionCount, 1, '失败退款不留新 action');
  // 退款事实落库（支付域）
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM refunds WHERE order_id = $1', [orderId])).rows[0].c, 1);

  // ================= 场景 7：解决 + 用户反馈 + 越权 =================
  const resolved = await (await fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/resolve`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ reply: '已协调全额退款，请留意到账' }) })).json();
  assert.equal(resolved.data.ticket.status, 'resolved');
  // 终态拒绝再处理
  await expectHttpError(fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/reply`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ text: 'x' }) }), 409, 'TICKET_STATE_CONFLICT');
  // 用户反馈（resolved 后确认）→ 幂等现状
  const feedback = await (await fetch(`${base}/api/mini/v1/tickets/${ticketId}/feedback`, { method: 'POST', headers: auth.ua, body: JSON.stringify({ satisfied: true }) })).json();
  assert.equal(feedback.data.ticket.status, 'resolved');
  // ub 越权访问 ua 的工单
  await expectHttpError(fetch(`${base}/api/mini/v1/tickets/${ticketId}`, { headers: auth.ub }), 404, 'NOT_FOUND');
  // ub 无法给 ua 的工单反馈
  await expectHttpError(fetch(`${base}/api/mini/v1/tickets/${ticketId}/feedback`, { method: 'POST', headers: auth.ub, body: JSON.stringify({ satisfied: false }) }), 404, 'NOT_FOUND');

  // ================= 场景 8：用户工单列表仅本人 =================
  const myTickets = await (await fetch(`${base}/api/mini/v1/tickets`, { headers: auth.ua })).json();
  assert.equal(myTickets.data.total, 1);
  const ubTickets = await (await fetch(`${base}/api/mini/v1/tickets`, { headers: auth.ub })).json();
  assert.equal(ubTickets.data.total, 0);
});
