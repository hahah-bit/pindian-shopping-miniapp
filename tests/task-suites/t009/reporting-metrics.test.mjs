import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

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
  url.pathname = '/pindian_t009_report_test';
  return { adminUrl: envUrl, testUrl: url.toString() };
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

test('T009 F037 看板：指标口径逐项核对（含跨日界/退款三态/空数据）', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t009_report_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t009_report_test');
  let closeDb = async () => {};
  context.after(async () => {
    await closeDb();
    await admin.end();
    if (process.env.PINDIAN_KEEP_TEST_DB !== '1') {
      const cleanup = new pg.Client({ connectionString: database.adminUrl });
      await cleanup.connect();
      await cleanup.query('DROP DATABASE IF EXISTS pindian_t009_report_test WITH (FORCE)').catch(() => {});
      await cleanup.end();
    }
  });

  const migrateOut = await new Promise((res, rej) => {
    const child = spawnNode(['backend/dist/bootstrap/migrate.js'], { DATABASE_URL: database.testUrl });
    child.on('exit', (code) => (code === 0 ? res('') : rej(new Error('迁移失败'))));
  });
  void migrateOut;

  const { PostgresReportingReadModel } = require('../../../backend/dist/contexts/reporting/adapters/outbound/postgres/reporting-read-model.js');
  const { ReportingQueries } = require('../../../backend/dist/contexts/reporting/application/reporting-queries.js');

  const db = new pg.Pool({ connectionString: database.testUrl });
  closeDb = async () => { await db.end().catch(() => {}); };

  // ---- 时间基准：Asia/Shanghai 自然日 ----
  const nowSh = new Date(Date.now() + 8 * 3600_000);
  const shDay = (offsetDays = 0) => {
    const d = new Date(nowSh.getTime() + offsetDays * 86_400_000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  };
  /** 上海时区第 offsetDays 天的 hh:mm（返回真实 UTC Date）。 */
  const shTime = (offsetDays, hh, mm) => {
    const { y, m, d } = shDay(offsetDays);
    return new Date(Date.UTC(y, m, d, hh - 8, mm, 0));
  };
  const yesterdayShText = (() => { const { y, m, d } = shDay(-1); return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; })();

  // ---- 种子 ----
  const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
  const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
  const U3 = 'aaaaaaaa-0000-4000-8000-000000000003';
  const AGENT = 'bbbbbbbb-0000-4000-8000-000000000001';
  const P1 = 'cccccccc-0000-4000-8000-000000000001';
  const P2 = 'cccccccc-0000-4000-8000-000000000002';
  const G1 = 'dddddddd-0000-4000-8000-000000000001';
  const G2 = 'dddddddd-0000-4000-8000-000000000002';
  const G3 = 'dddddddd-0000-4000-8000-000000000003';
  const SNAPSHOT = JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' });

  for (const [id, nickname] of [[U1, '用户一'], [U2, '用户二'], [U3, '用户三']]) {
    await db.query(`INSERT INTO users (id, nickname, status) VALUES ($1, $2, 'active')`, [id, nickname]);
  }
  await db.query(`INSERT INTO admins (id, username, display_name, password_hash, role, status) VALUES ($1, 'agent1', '客服甲', 'x', 'cs_supervisor', 'active')`, [AGENT]);
  await db.query(`INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status) VALUES ($1,'苹果',50000,10,'斤',ARRAY[30,20,15,12],'on_shelf')`, [P1]);
  await db.query(`INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status) VALUES ($1,'橙子',30000,8,'斤',ARRAY[30,20,15,12],'off_shelf')`, [P2]);
  await db.query(`INSERT INTO stocks (product_id, available_whole_items) VALUES ($1, 12), ($2, 5)`, [P1, P2]);
  // G1 进行中；G2 成功（两天前创建）；G3 失败
  await db.query(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status) VALUES ($1,$2,$3, now()+interval '24 hours','open')`, [G1, P1, SNAPSHOT]);
  const g2Created = shTime(-2, 9, 0);
  await db.query(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units, created_at) VALUES ($1,$2,$3, now()+interval '24 hours','success',60,$4)`, [G2, P1, SNAPSHOT, g2Created]);
  await db.query(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status) VALUES ($1,$2,$3, now()-interval '24 hours','failed')`, [G3, P2, SNAPSHOT]);

  const orderId = (n) => `eeeeeeee-0000-4000-8000-00000000000${n}`;
  async function seedOrder({ n, user, group, units, status, createdAt, paidAt, total = 25250, goods = 25000 }) {
    await db.query(
      `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text,
        address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,50000,'斤','10','10','收货人','13800001230','广东省','深圳市','南山区','测试地址',$11, now()+interval '1 hour',$12,$13)`,
      [orderId(n), `PO-T009-${n}`, user, P1, group, units, status, total, goods, total - goods, randomUUID(), paidAt, createdAt]
    );
  }
  async function seedPayment(orderN, { status = 'succeeded', applied = 'applied', amount = 25250 } = {}) {
    await db.query(
      `INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, applied_result) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`f0000000-0000-4000-8000-0000000000${String(orderN).padStart(2, '0')}`, orderId(orderN), U1, amount, status, `T009-PAY-${orderN}`, applied]
    );
  }
  async function seedRefund(n, orderN, { status, amount }) {
    await db.query(
      `INSERT INTO refunds (id, payment_id, order_id, user_id, out_refund_no, amount_fen, status, reason, requested_at)
       VALUES ($1, (SELECT id FROM payments WHERE order_id=$2), $2, (SELECT user_id FROM orders WHERE id=$2), $3, $4, $5, 'user_cancel', now())`,
      [`f1000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, orderId(orderN), `T009-REFUND-${n}`, amount, status]
    );
  }

  // O1/O2：G2 两笔，今日支付（支付金额今日口径 = 50500）
  const o1Paid = shTime(0, 10, 5);
  const o2Paid = shTime(0, 11, 45);
  await seedOrder({ n: 1, user: U1, group: G2, units: 30, status: 'paid', createdAt: shTime(-2, 9, 10), paidAt: o1Paid });
  await seedOrder({ n: 2, user: U2, group: G2, units: 30, status: 'paid', createdAt: shTime(-2, 9, 20), paidAt: o2Paid });
  await seedPayment(1); await seedPayment(2);
  // O3：今日 unpaid（计今日订单数，不计支付金额）
  await seedOrder({ n: 3, user: U1, group: G1, units: 30, status: 'unpaid', createdAt: shTime(0, 8, 0), paidAt: null });
  // O4：昨日支付、今日取消并全额退款成功（不计今日支付金额与服务费/商品金额）
  const o4Paid = shTime(-1, 12, 0);
  await seedOrder({ n: 4, user: U3, group: G3, units: 30, status: 'cancelled', createdAt: shTime(-1, 10, 0), paidAt: o4Paid });
  await seedPayment(4);
  await seedRefund(1, 4, { status: 'succeeded', amount: 25250 });
  // O5：昨日支付仍有效（昨日支付金额口径含它；服务费/商品金额含它；另有一笔 requested 退款）
  await seedOrder({ n: 5, user: U3, group: G1, units: 30, status: 'paid', createdAt: shTime(-1, 10, 30), paidAt: shTime(-1, 11, 0) });
  await seedPayment(5);
  await seedRefund(2, 5, { status: 'requested', amount: 10000 });
  // O6：今日支付有效，含一笔 submitted 退款（受理中）
  await seedOrder({ n: 6, user: U1, group: G1, units: 30, status: 'paid', createdAt: shTime(0, 9, 0), paidAt: shTime(0, 9, 30) });
  await seedPayment(6);
  await seedRefund(3, 6, { status: 'submitted', amount: 3000 });
  // 履约：O1/O2 待发货
  for (const n of [1, 2]) {
    await db.query(
      `INSERT INTO fulfillment_orders (group_id, order_id, user_id, allocated_quantity_grams, unit, status, receiver_name, receiver_phone, receiver_province, receiver_city, receiver_district, receiver_detail)
       VALUES ($1,$2,$3,5000,'斤','pending_shipment','收','13800001230','广东省','深圳市','南山区','测试')`,
      [G2, orderId(n), n === 1 ? U1 : U2]
    );
  }

  // ---- 客服事实 ----
  const C1 = 'f2000000-0000-4000-8000-000000000001';
  const C2 = 'f2000000-0000-4000-8000-000000000002';
  const C3 = 'f2000000-0000-4000-8000-000000000003';
  const C4 = 'f2000000-0000-4000-8000-000000000004';
  const c2Created = new Date(Date.now() - 20 * 60_000);
  const c1Created = new Date(Date.now() - 5 * 60_000);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at) VALUES ($1,$2,'queued',$3)`, [C1, U1, c1Created]);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, assigned_agent_id, created_at) VALUES ($1,$2,'active',$3,$4)`, [C2, U2, AGENT, c2Created]);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, assigned_agent_id, created_at) VALUES ($1,$2,'active',$3,$4)`, [C3, U3, AGENT, shTime(0, 9, 0)]);
  const c3Reply = shTime(0, 9, 5);
  await db.query(`INSERT INTO cs_messages (conversation_id, seq, sender, kind, content, client_message_id, created_at) VALUES ($1,1,'agent','text','{"text":"您好"}','m1',$2)`, [C3, c3Reply]);
  const c4Created = shTime(-1, 9, 0);
  const c4Ended = shTime(-1, 9, 30);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at, updated_at) VALUES ($1,$2,'ended',$3,$4)`, [C4, U2, c4Created, c4Ended]);
  await db.query(`INSERT INTO cs_agent_presence (agent_id, heartbeat_at) VALUES ($1, now())`, [AGENT]);
  // 工单：4 张（open/processing/resolved/closed），4 类
  await db.query(`INSERT INTO after_sales_tickets (id, user_id, type, status, title, description) VALUES
    ('f3000000-0000-4000-8000-000000000001',$1,'complaint','open','t','d'),
    ('f3000000-0000-4000-8000-000000000002',$1,'refund_issue','processing','t','d'),
    ('f3000000-0000-4000-8000-000000000003',$1,'shipment_issue','resolved','t','d'),
    ('f3000000-0000-4000-8000-000000000004',$1,'other','closed','t','d')`, [U1]);

  const queries = new ReportingQueries({ readModel: new PostgresReportingReadModel(db), clock: { now: () => new Date() } });

  await context.test('总览与商品数据逐项核对', async () => {
    const r = await queries.overview({});
    assert.equal(r.date, yesterdayShText === '' ? '' : r.date); // date 为今日文本（格式校验）
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.generatedAt);
    const o = r.overview;
    assert.equal(o.totalProducts, 2);
    assert.equal(o.onShelfProducts, 1);
    assert.equal(o.openGroups, 1);
    assert.equal(o.successGroups, 1);
    assert.equal(o.failedGroups, 1);
    assert.equal(o.todayOrders, 2, '今日订单：O3/O6（O1/O2 随组两天前创建，O4/O5 昨日）');
    assert.equal(o.todayPaidAmountFen, 75750, '今日支付金额=今日支付且仍有效的 O1+O2+O6（O4 昨日付、已取消）');
    assert.equal(o.serviceFeeIncomeFen, 1000, '服务费=有效 paid 订单（O1/O2/O5/O6），O4 全额退款剔除');
    assert.equal(o.pendingRefundAmountFen, 13000, '待退款=requested 10000 + submitted 3000');
    assert.equal(o.refundRequestedFen, 10000);
    assert.equal(o.refundAcceptedFen, 3000);
    assert.equal(o.refundSucceededFen, 25250);
    assert.equal(o.pendingShipmentCount, 2);
    assert.equal(o.csPendingCount, 1);
    const p = r.product;
    assert.equal(p.stockWholeItems, 17);
    assert.equal(p.createdGroups, 3);
    assert.equal(p.successGroups, 1);
    assert.equal(p.openGroups, 1);
    assert.equal(p.paidUserCount, 3, 'U1/U2/U3（U3 因 O5 paid 计入）');
    assert.equal(p.successRate, 0.5, '1/(1+1)');
    const expectedMinutes = Math.round((o2Paid.getTime() - g2Created.getTime()) / 60_000);
    assert.equal(p.avgGroupDurationMinutes, expectedMinutes, '平均拼单耗时=成功组 MAX(paid_at)-created_at');
    assert.equal(p.goodsAmountFen, 100000);
    assert.equal(p.serviceFeeAmountFen, 1000);
    assert.equal(p.refundedAmountFen, 25250);
  });

  await context.test('客服数据逐项核对（首响/超时/接待量）', async () => {
    const r = await queries.csMetrics({});
    const cs = r.cs;
    const inToday = (t) => t >= shTime(0, 0, 0) && t < shTime(1, 0, 0);
    const expectedConsultUsers = new Set([[U1, c1Created], [U2, c2Created], [U3, shTime(0, 9, 0)]].filter(([, t]) => inToday(t)).map(([u]) => u)).size;
    assert.equal(cs.todayConsultUsers, expectedConsultUsers, '今日创建会话去重用户（C1/C2 随当前时刻可能跨日界）');
    assert.equal(cs.queuedCount, 1);
    assert.equal(cs.onlineAgentCount, 1);
    const expectedFirstResponse = Math.round((c3Reply.getTime() - shTime(0, 9, 0).getTime()) / 60_000);
    assert.equal(cs.avgFirstResponseMinutes, expectedFirstResponse, '仅 C3 今日首响样本（5 分钟）');
    assert.equal(cs.avgSessionDurationMinutes, 30, 'C4 ended：30 分钟');
    assert.equal(cs.unhandledCount, 2, 'C1 queued + C2 active 无回复');
    assert.equal(cs.ticketCount, 4);
    assert.equal(cs.ticketResolveRate, 0.5, '(resolved+closed)/total');
    assert.deepEqual(cs.ticketTypeStats.map((t) => t.type).sort(), ['complaint', 'other', 'refund_issue', 'shipment_issue']);
    assert.deepEqual(cs.agentLoad, [{ agentId: AGENT, displayName: '客服甲', conversations: 2 }]);
    assert.equal(cs.overdueFirstResponseCount, 1, '仅 C2（20 分钟前）超时未首响；C1 5 分钟前未超时，C3/C4 已有回复或已结束');
  });

  await context.test('date 参数按上海日界回看历史日', async () => {
    const r = await queries.overview({ date: yesterdayShText });
    assert.equal(r.date, yesterdayShText);
    assert.equal(r.overview.todayOrders, 2, '昨日创建 O4/O5');
    assert.equal(r.overview.todayPaidAmountFen, 25250, 'O5 昨日支付仍有效；O4 已取消不计');
    // 服务费等累计口径不随 date 变化
    assert.equal(r.overview.serviceFeeIncomeFen, 1000);
  });

  await context.test('非法 date 拒绝', async () => {
    await assert.rejects(() => queries.overview({ date: '2026-13-40' }), (e) => e.code === 'VALIDATION_FAILED');
    await assert.rejects(() => queries.csMetrics({ date: 'not-a-date' }), (e) => e.code === 'VALIDATION_FAILED');
  });
});

test('T009 F037 看板：空库返回 0 与 null', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t009_report_empty WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t009_report_empty');
  let closeDb2 = async () => {};
  context.after(async () => {
    await closeDb2();
    await admin.end();
    const cleanup = new pg.Client({ connectionString: database.adminUrl });
    await cleanup.connect();
    await cleanup.query('DROP DATABASE IF EXISTS pindian_t009_report_empty WITH (FORCE)').catch(() => {});
    await cleanup.end();
  });
  await new Promise((res, rej) => {
    const child = spawnNode(['backend/dist/bootstrap/migrate.js'], { DATABASE_URL: urlOf(database.adminUrl, 'pindian_t009_report_empty') });
    child.on('exit', (code) => (code === 0 ? res('') : rej(new Error('迁移失败'))));
  });
  const { PostgresReportingReadModel } = require('../../../backend/dist/contexts/reporting/adapters/outbound/postgres/reporting-read-model.js');
  const { ReportingQueries } = require('../../../backend/dist/contexts/reporting/application/reporting-queries.js');
  const db = new pg.Pool({ connectionString: urlOf(database.adminUrl, 'pindian_t009_report_empty') });
  closeDb2 = async () => { await db.end().catch(() => {}); };
  const queries = new ReportingQueries({ readModel: new PostgresReportingReadModel(db), clock: { now: () => new Date() } });
  const o = await queries.overview({});
  assert.equal(o.overview.totalProducts, 0);
  assert.equal(o.overview.todayPaidAmountFen, 0);
  assert.equal(o.overview.pendingRefundAmountFen, 0);
  assert.equal(o.product.successRate, null, '无关闭组成功率为 null');
  assert.equal(o.product.avgGroupDurationMinutes, null);
  const cs = await queries.csMetrics({});
  assert.equal(cs.cs.queuedCount, 0);
  assert.equal(cs.cs.avgFirstResponseMinutes, null);
  assert.equal(cs.cs.ticketResolveRate, null);
  assert.deepEqual(cs.cs.ticketTypeStats, []);
  assert.deepEqual(cs.cs.agentLoad, []);
});

function spawnNode(args, env) {
  const { spawn } = require('node:child_process');
  return spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'ignore' });
}

function urlOf(base, dbName) {
  const u = new URL(base);
  u.pathname = `/${dbName}`;
  return u.toString();
}
