import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const require = createRequire(import.meta.url);

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
  url.pathname = '/pindian_t009_integration_test';
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

test('T009 集成：看板三端点与权限、通知管道、超时提醒、审计查询（真实 PG+HTTP+生产装配）', { timeout: 300_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t009_integration_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t009_integration_test');
  let closeDb = async () => {};
  context.after(async () => {
    await closeDb();
    if (api.exitCode === null) api.kill();
    await new Promise((r) => { api.once('exit', r); setTimeout(r, 3000).unref(); });
    rmSync(mediaDir, { recursive: true, force: true });
    await admin.end();
    if (process.env.PINDIAN_KEEP_TEST_DB !== '1') {
      const cleanup = new pg.Client({ connectionString: database.adminUrl });
      await cleanup.connect();
      await cleanup.query('DROP DATABASE IF EXISTS pindian_t009_integration_test WITH (FORCE)').catch(() => {});
      await cleanup.end();
    }
  });

  const migrateOut = await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`迁移失败：${out}`))));
  });
  assert.match(migrateOut, /已应用 0027/);

  const port = await unusedPort();
  const mediaDir = mkdtempSync(join(tmpdir(), 'pindian-t009-'));
  const logs = { text: '' };
  const api = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATABASE_URL: database.testUrl, MEDIA_DIR: mediaDir, PUBLIC_API_BASE_URL: `http://127.0.0.1:${port}`, CS_FIRST_RESPONSE_TIMEOUT_MINUTES: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  api.stdout.on('data', (d) => { logs.text += d; });
  api.stderr.on('data', (d) => { logs.text += d; });
  const base = `http://127.0.0.1:${port}`;
  await waitForOk(`${base}/api/health/ready`, api, logs.text);

  // ---- 种子 ----
  const db = new pg.Pool({ connectionString: database.testUrl });
  closeDb = async () => { await db.end().catch(() => {}); };
  const UA = 'aaaaaaaa-9999-4999-8999-000000000001';
  const UB = 'aaaaaaaa-9999-4999-8999-000000000002';
  const UC = 'aaaaaaaa-9999-4999-8999-000000000003';
  for (const [id, name] of [[UA, '集成甲'], [UB, '集成乙'], [UC, '集成丙']]) {
    await db.query(`INSERT INTO users (id, nickname, status) VALUES ($1, $2, 'active')`, [id, name]);
  }
  const userTokens = {};
  for (const [key, id] of Object.entries({ ua: UA, ub: UB, uc: UC })) {
    const token = `tok-${key}-${Date.now()}`;
    await db.query(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [id, createHash('sha256').update(token).digest('hex')]);
    userTokens[key] = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  const SUPER = randomUUID();
  const SUPERVISOR = randomUUID();
  const AGENT = randomUUID();
  const CATALOG = randomUUID();
  await db.query(
    `INSERT INTO admins (id, username, display_name, password_hash, role, status) VALUES
      ($1,'t009-super','超管甲','x','super_admin','active'),
      ($2,'t009-sup','主管乙','x','cs_supervisor','active'),
      ($3,'t009-agent','客服丙','x','cs_agent','active'),
      ($4,'t009-catalog','商品丁','x','catalog_admin','active')`,
    [SUPER, SUPERVISOR, AGENT, CATALOG]
  );
  const adminTokens = {};
  for (const [key, id] of Object.entries({ super: SUPER, sup: SUPERVISOR, agent: AGENT, catalog: CATALOG })) {
    const token = `atok-${key}-${Date.now()}`;
    await db.query(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [id, createHash('sha256').update(token).digest('hex')]);
    adminTokens[key] = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  const P = 'cccccccc-9999-4999-8999-000000000001';
  const G1 = 'dddddddd-9999-4999-8999-000000000001';
  const G2 = 'dddddddd-9999-4999-8999-000000000002';
  await db.query(`INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status) VALUES ($1,'集成苹果',50000,10,'斤',ARRAY[30,20,15,12],'on_shelf')`, [P]);
  await db.query(`INSERT INTO stocks (product_id, available_whole_items) VALUES ($1, 7)`, [P]);
  const SNAPSHOT = JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' });
  const g1Created = new Date(Date.now() - 2 * 3600_000);
  await db.query(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units, created_at) VALUES ($1,$2,$3, now()+interval '24 hours','success',60,$4)`, [G1, P, SNAPSHOT, g1Created]);
  await db.query(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status) VALUES ($1,$2,$3, now()+interval '24 hours','open')`, [G2, P, SNAPSHOT]);

  const O1 = randomUUID();
  const O2 = randomUUID();
  const O3 = randomUUID();
  async function seedOrder(id, orderNo, userId, groupId, status, paidAt) {
    await db.query(
      `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text,
        address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at)
       VALUES ($1,$2,$3,$4,$5,30,$6,25250,25000,250,false,50000,'斤','10','10','收','13800001230','广东省','深圳市','南山区','地址',$7, now()+interval '1 hour',$8)`,
      [id, orderNo, userId, P, groupId, status, randomUUID(), paidAt]
    );
  }
  seedOrder(O1, 'PO-T009I-1', UA, G1, 'paid', new Date());
  seedOrder(O2, 'PO-T009I-2', UB, G1, 'paid', new Date());
  seedOrder(O3, 'PO-T009I-3', UA, G2, 'unpaid', null);
  const PAY1 = randomUUID();
  const PAY2 = randomUUID();
  await db.query(`INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, applied_result) VALUES ($1,$2,$3,25250,'succeeded','T009I-P1','applied')`, [PAY1, O1, UA]);
  await db.query(`INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, applied_result) VALUES ($1,$2,$3,25250,'succeeded','T009I-P2','applied')`, [PAY2, O2, UB]);
  const REF1 = randomUUID();
  const REF2 = randomUUID();
  await db.query(`INSERT INTO refunds (id, payment_id, order_id, user_id, out_refund_no, amount_fen, status, reason) VALUES ($1,$2,$3,$4,'T009I-R1',25250,'succeeded','user_cancel')`, [REF1, PAY1, O1, UA]);
  await db.query(`INSERT INTO refunds (id, payment_id, order_id, user_id, out_refund_no, amount_fen, status, reason) VALUES ($1,$2,$3,$4,'T009I-R2',10000,'requested','user_cancel')`, [REF2, PAY2, O2, UB]);
  await db.query(
    `INSERT INTO fulfillment_orders (group_id, order_id, user_id, allocated_quantity_grams, unit, status, receiver_name, receiver_phone, receiver_province, receiver_city, receiver_district, receiver_detail)
     VALUES ($1,$2,$3,2500,'斤','pending_shipment','收','13800001230','广东省','深圳市','南山区','地址')`,
    [G1, O2, UB]
  );

  const C1 = randomUUID();
  const C2 = randomUUID();
  const C3 = randomUUID();
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, assigned_agent_id, created_at) VALUES ($1,$2,'active',$3, now() - interval '5 minutes')`, [C1, UB, SUPERVISOR]);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at) VALUES ($1,$2,'active', now() - interval '3 minutes')`, [C2, UA]);
  await db.query(`INSERT INTO cs_messages (conversation_id, seq, sender, kind, content, internal, client_message_id) VALUES ($1,1,'agent','text','{"text":"在的"}',false,'i-a1')`, [C2]);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at) VALUES ($1,$2,'queued', now())`, [C3, UC]);
  await db.query(`INSERT INTO cs_agent_presence (agent_id, heartbeat_at) VALUES ($1, now())`, [SUPERVISOR]);
  await db.query(`INSERT INTO after_sales_tickets (id, user_id, type, status, title, description) VALUES
    ($1,$2,'complaint','open','t','d'), ($3,$2,'refund_issue','resolved','t','d')`, [randomUUID(), UA, randomUUID()]);

  const http = async (path, { method = 'GET', headers = {}, body } = {}) => {
    const response = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return response;
  };

  // ================= 场景 1：看板数值与权限 =================
  await context.test('看板总览/商品数据与超级管理员访问', async () => {
    const response = await http('/admin/v1/reporting/overview', { headers: adminTokens.super });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    const o = data.overview;
    assert.equal(o.totalProducts, 1);
    assert.equal(o.onShelfProducts, 1);
    assert.equal(o.openGroups, 1);
    assert.equal(o.successGroups, 1);
    assert.equal(o.failedGroups, 0);
    assert.equal(o.todayOrders, 3);
    assert.equal(o.todayPaidAmountFen, 50500, 'O1+O2 今日支付（O1 虽已全额退款但支付事实在今日）');
    assert.equal(o.serviceFeeIncomeFen, 250, 'O1 全额退款剔除，仅 O2');
    assert.equal(o.pendingRefundAmountFen, 10000);
    assert.equal(o.refundRequestedFen, 10000);
    assert.equal(o.refundAcceptedFen, 0);
    assert.equal(o.refundSucceededFen, 25250);
    assert.equal(o.pendingShipmentCount, 1);
    assert.equal(o.csPendingCount, 1);
    const p = data.product;
    assert.equal(p.stockWholeItems, 7);
    assert.equal(p.createdGroups, 2);
    assert.equal(p.paidUserCount, 2);
    assert.equal(p.successRate, 1);
    assert.equal(p.goodsAmountFen, 25000);
    assert.equal(p.serviceFeeAmountFen, 250);
    assert.equal(p.refundedAmountFen, 25250);
    assert.ok(p.avgGroupDurationMinutes >= 110, `拼单耗时约 120 分钟（实际 ${p.avgGroupDurationMinutes}）`);
    // 历史日：无订单
    const yesterday = new Date(Date.now() + 8 * 3600_000 - 86_400_000);
    const yesterdayText = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;
    const hist = await (await http(`/admin/v1/reporting/overview?date=${yesterdayText}`, { headers: adminTokens.super })).json();
    assert.equal(hist.data.overview.todayOrders, 0);
    assert.equal(hist.data.overview.todayPaidAmountFen, 0);
  });

  await context.test('看板客服数据与阈值（环境变量 1 分钟）', async () => {
    const response = await http('/admin/v1/reporting/customer-service', { headers: adminTokens.super });
    assert.equal(response.status, 200);
    const cs = (await response.json()).data.cs;
    assert.equal(cs.todayConsultUsers, 3);
    assert.equal(cs.queuedCount, 1);
    assert.equal(cs.onlineAgentCount, 1);
    assert.equal(cs.unhandledCount, 2, 'C1 活跃无回复 + C3 排队');
    assert.equal(cs.overdueFirstResponseCount, 1, '仅 C1 超过 1 分钟未首响');
    assert.equal(cs.ticketCount, 2);
    assert.equal(cs.ticketResolveRate, 0.5);
    assert.deepEqual(cs.agentLoad, [{ agentId: SUPERVISOR, displayName: '主管乙', conversations: 1 }]);
    assert.ok(cs.avgFirstResponseMinutes >= 1, 'C2 首响样本');
  });

  await context.test('权限矩阵：客服主管只见客服数据，客服/商品管理员与未认证被拒', async () => {
    assert.equal((await http('/admin/v1/reporting/customer-service', { headers: adminTokens.sup })).status, 200);
    await expectHttpError(http('/admin/v1/reporting/overview', { headers: adminTokens.sup }), 403, 'FORBIDDEN');
    await expectHttpError(http('/admin/v1/reporting/overview', { headers: adminTokens.catalog }), 403, 'FORBIDDEN');
    await expectHttpError(http('/admin/v1/reporting/customer-service', { headers: adminTokens.catalog }), 403, 'FORBIDDEN');
    await expectHttpError(http('/admin/v1/reporting/overview', { headers: adminTokens.agent }), 403, 'FORBIDDEN');
    await expectHttpError(http('/admin/v1/audit/logs', { headers: adminTokens.agent }), 403, 'FORBIDDEN');
    await expectHttpError(http('/admin/v1/notifications/deliveries', { headers: adminTokens.agent }), 403, 'FORBIDDEN');
    await expectHttpError(http('/admin/v1/reporting/overview', {}), 401, 'UNAUTHENTICATED');
    // 资金审核权限边界不变：客服无审核权
    await expectHttpError(http('/admin/v1/after-sales/requests/x/review', { method: 'POST', headers: adminTokens.agent, body: { decision: 'approve' } }), 403, 'FORBIDDEN');
  });

  // ================= 场景 2：通知事件补抓 + 消息中心 =================
  await context.test('业务事件补抓：退款/拼单成功通知与消息中心已读', async () => {
    const { PostgresNotificationScanPort } = require('../../../backend/dist/contexts/notifications/adapters/outbound/postgres/scan-ports.js');
    const { PostgresNotificationRepository } = require('../../../backend/dist/contexts/notifications/adapters/outbound/postgres/notification-repository.js');
    const { RecordNotification } = require('../../../backend/dist/contexts/notifications/application/record-notification.js');
    const { CatchUpBusinessEvents } = require('../../../backend/dist/contexts/notifications/application/event-catchup.js');
    const catchup = new CatchUpBusinessEvents({ scanPort: new PostgresNotificationScanPort(db), recorder: new RecordNotification({ repository: new PostgresNotificationRepository(db), clock: { now: () => new Date() } }) });
    const first = await catchup.execute({ limit: 100 });
    assert.equal(first.created, 3, '拼单成功 2 + 退款到账 1');
    assert.equal((await catchup.execute({ limit: 100 })).created, 0, '二次补抓幂等');

    const list = await (await http('/mini/v1/notifications', { headers: userTokens.ua })).json();
    assert.equal(list.data.total, 2, '甲：拼单成功(O1) + 退款到账(R1)');
    assert.equal(list.data.unreadCount, 2);
    const refundNote = list.data.items.find((n) => n.eventType === 'refund.succeeded');
    assert.ok(refundNote);
    assert.equal(refundNote.reference.refundId, REF1);
    const read = await (await http(`/mini/v1/notifications/${refundNote.id}/read`, { method: 'POST', headers: userTokens.ua })).json();
    assert.ok(read.data.notification.readAt);
    const firstReadAt = read.data.notification.readAt;
    const again = await (await http(`/mini/v1/notifications/${refundNote.id}/read`, { method: 'POST', headers: userTokens.ua })).json();
    assert.equal(again.data.notification.readAt, firstReadAt, '已读幂等保留首次时间');
    const afterRead = await (await http('/mini/v1/notifications', { headers: userTokens.ua })).json();
    assert.equal(afterRead.data.unreadCount, 1);
    // 他人不可见/不可标已读
    await expectHttpError(http(`/mini/v1/notifications/${refundNote.id}/read`, { method: 'POST', headers: userTokens.ub }), 404, 'NOT_FOUND');
    const ubList = await (await http('/mini/v1/notifications', { headers: userTokens.ub })).json();
    assert.equal(ubList.data.total, 1, '乙只有拼单成功(O2)');
    await expectHttpError(http('/mini/v1/notifications', { headers: {} }), 401, 'UNAUTHENTICATED');
  });

  // ================= 场景 3：投递驱动 + 手工重试 + 审计 =================
  await context.test('投递 skipped 留痕；仅 failed 可手工重试并写审计', async () => {
    const { PostgresNotificationRepository } = require('../../../backend/dist/contexts/notifications/adapters/outbound/postgres/notification-repository.js');
    const { UnconfiguredChannelAdapter } = require('../../../backend/dist/contexts/notifications/adapters/outbound/channel/unconfigured-channel.js');
    const { DriveDeliveries } = require('../../../backend/dist/contexts/notifications/application/delivery-driver.js');
    const driver = new DriveDeliveries({ repository: new PostgresNotificationRepository(db), channels: [new UnconfiguredChannelAdapter()], clock: { now: () => new Date() } });
    await driver.execute({ limit: 100 });
    const skipped = await db.query(`SELECT COUNT(*)::int c FROM notification_deliveries WHERE status='skipped' AND skipped_reason='channel_not_configured'`);
    assert.ok(skipped.rows[0].c >= 3, 'D021：全部投递以 skipped 留痕');

    const listResponse = await http('/admin/v1/notifications/deliveries?status=skipped&page=1&pageSize=10', { headers: adminTokens.super });
    const list = await listResponse.json();
    assert.equal(listResponse.status, 200, `投递列表应 200：${JSON.stringify(list).slice(0, 300)}
API日志尾部：${logs.text.slice(-1200)}`);
    assert.ok(list.data.total >= 3);
    const row = list.data.items[0];
    assert.equal(row.status, 'skipped');
    assert.equal(row.skippedReason, 'channel_not_configured');
    assert.ok(row.recipientName.length > 0);
    await expectHttpError(http(`/admin/v1/notifications/deliveries/${row.id}/retry`, { method: 'POST', headers: adminTokens.super }), 409, 'DELIVERY_NOT_RETRYABLE');

    // 模拟历史失败投递 → 手工重试 → 审计
    await db.query(`UPDATE notification_deliveries SET status='failed', last_error='渠道 500', attempt_count=2, next_attempt_at=now() + interval '1 hour' WHERE id = (SELECT id FROM notification_deliveries WHERE status='skipped' LIMIT 1)`);
    const failedRow = (await db.query(`SELECT id FROM notification_deliveries WHERE status='failed' LIMIT 1`)).rows[0];
    const retry = await (await http(`/admin/v1/notifications/deliveries/${failedRow.id}/retry`, { method: 'POST', headers: adminTokens.super })).json();
    assert.equal(retry.data.delivery.status, 'pending');
    assert.equal(retry.data.delivery.attemptCount, 0);
    const auditRow = await db.query(`SELECT admin_id FROM admin_operation_logs WHERE action='notification.retry' AND resource_id=$1`, [failedRow.id]);
    assert.equal(auditRow.rows.length, 1);
    assert.equal(auditRow.rows[0].admin_id, SUPER);
  });

  // ================= 场景 4：超时提醒 =================
  await context.test('超时提醒：对在线主管生成且幂等', async () => {
    const { PostgresNotificationScanPort } = require('../../../backend/dist/contexts/notifications/adapters/outbound/postgres/scan-ports.js');
    const { PostgresNotificationRepository } = require('../../../backend/dist/contexts/notifications/adapters/outbound/postgres/notification-repository.js');
    const { RecordNotification } = require('../../../backend/dist/contexts/notifications/application/record-notification.js');
    const { ScanTimeoutConversations } = require('../../../backend/dist/contexts/notifications/application/timeout-reminder.js');
    const reminder = new ScanTimeoutConversations({ scanPort: new PostgresNotificationScanPort(db), recorder: new RecordNotification({ repository: new PostgresNotificationRepository(db), clock: { now: () => new Date() } }), clock: { now: () => new Date() }, thresholdMinutes: 1 });
    const first = await reminder.execute({ limit: 100 });
    assert.equal(first.created, 1, 'C1 × 在线主管乙恰一条');
    const rows = await db.query(`SELECT recipient_admin_id, idempotency_key FROM notifications WHERE event_type='cs.conversation.timeout'`);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].recipient_admin_id, SUPERVISOR);
    assert.equal((await reminder.execute({ limit: 100 })).created, 0, '二次扫描幂等');
  });

  // ================= 场景 5：审计查询 =================
  await context.test('审计查询：筛选、脱敏与角色矩阵', async () => {
    const response = await http('/admin/v1/audit/logs?action=notification.retry&page=1&pageSize=10', { headers: adminTokens.super });
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.total, 1);
    assert.equal(data.items[0].adminDisplayName, '超管甲');
    // 脱敏：种子带手机号的日志
    await db.query(`INSERT INTO admin_operation_logs (admin_id, action, resource_type, resource_id, detail) VALUES ($1,'fulfillment.update_receiver','fulfillment_order','fo-1','{"phone":"13800001230","receiver":"收货人"}')`, [SUPER]);
    const masked = (await (await http('/admin/v1/audit/logs?action=fulfillment.update_receiver&page=1&pageSize=10', { headers: adminTokens.super })).json()).data;
    const text = JSON.stringify(masked);
    assert.match(text, /138\*\*\*\*1230/);
    assert.doesNotMatch(text, /13800001230/);
    // 角色矩阵
    const matrix = (await (await http('/admin/v1/access/role-matrix', { headers: adminTokens.super })).json()).data;
    assert.equal(matrix.roles.length, 4);
    const supervisor = matrix.roles.find((r) => r.role === 'cs_supervisor');
    assert.ok(supervisor.permissions.includes('reporting:view_cs'));
    // 时间范围参数
    const today = new Date(Date.now() + 8 * 3600_000);
    const todayText = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    const ranged = (await (await http(`/admin/v1/audit/logs?from=${todayText}&to=${todayText}&page=1&pageSize=50`, { headers: adminTokens.super })).json()).data;
    assert.equal(ranged.total, data.total + 1, '含手机号日志与 notification.retry 均在今天');
    await expectHttpError(http('/admin/v1/audit/logs', { headers: adminTokens.sup }), 403, 'FORBIDDEN');
  });
});
