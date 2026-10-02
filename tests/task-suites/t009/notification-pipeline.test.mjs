import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  url.pathname = '/pindian_t009_notif_test';
  return { adminUrl: envUrl, testUrl: url.toString() };
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

// ================= 领域规则（纯单测，不依赖数据库） =================

test('T009 F038 领域：通知创建校验与已读幂等', () => {
  const { Notification } = require('../../../backend/dist/contexts/notifications/domain/notification.js');
  const now = new Date('2026-10-02T08:00:00Z');
  const valid = {
    recipientUserId: randomUUID(),
    eventType: 'group.succeeded',
    title: '拼单成功',
    body: '您参与的拼单已成功',
    reference: { orderId: 'o1' },
    idempotencyKey: 'group.succeeded:o1'
  };
  const n = Notification.create(valid, now);
  assert.equal(n.state.title, '拼单成功');
  assert.equal(n.state.deliveries.length, 1, '创建即生成初始投递');
  assert.equal(n.state.deliveries[0].status, 'pending');
  assert.equal(n.state.deliveries[0].channel, 'wechat_subscribe_message');
  assert.equal(n.state.deliveries[0].maxAttempts, 5);

  assert.throws(() => Notification.create({ ...valid, recipientAdminId: randomUUID() }, now), /恰一/, '接收者必须恰一');
  assert.throws(() => Notification.create({ ...valid, title: 'x'.repeat(121) }, now), /120/, '标题超长拒绝');
  assert.throws(() => Notification.create({ ...valid, idempotencyKey: '' }, now), /幂等/, '幂等键必填');

  const otherUser = randomUUID();
  assert.throws(() => n.markRead(otherUser, now), (e) => e.code === 'NOT_FOUND', '非接收者不能置已读');
  n.markRead(valid.recipientUserId, new Date('2026-10-02T09:00:00Z'));
  n.markRead(valid.recipientUserId, new Date('2026-10-02T10:00:00Z'));
  assert.equal(n.state.readAt.toISOString(), '2026-10-02T09:00:00.000Z', '已读幂等保留首次时间');
});

test('T009 F038 领域：投递状态机与手工重试边界', () => {
  const { Notification, recordDeliveryAttempt, resetDeliveryForManualRetry } = require('../../../backend/dist/contexts/notifications/domain/notification.js');
  const now = new Date('2026-10-02T08:00:00Z');
  const n = Notification.create({ recipientUserId: randomUUID(), eventType: 'e', title: 't', body: 'b', reference: {}, idempotencyKey: 'k' }, now);
  const d = n.state.deliveries[0];

  recordDeliveryAttempt(d, { outcome: 'skipped', reason: 'channel_not_configured' }, now);
  assert.equal(d.status, 'skipped');
  assert.equal(d.skippedReason, 'channel_not_configured');
  assert.throws(() => resetDeliveryForManualRetry(d, now), (e) => e.code === 'DELIVERY_NOT_RETRYABLE', 'skipped 不可手工重试');

  const n2 = Notification.create({ recipientUserId: randomUUID(), eventType: 'e', title: 't', body: 'b', reference: {}, idempotencyKey: 'k2' }, now);
  const d2 = n2.state.deliveries[0];
  const t1 = new Date('2026-10-02T08:00:00Z');
  recordDeliveryAttempt(d2, { outcome: 'failed', error: '渠道 500' }, t1);
  assert.equal(d2.status, 'failed');
  assert.equal(d2.attemptCount, 1);
  assert.equal(d2.nextAttemptAt.toISOString(), '2026-10-02T08:02:00.000Z', '第 1 次失败退避 2^1 分钟');
  recordDeliveryAttempt(d2, { outcome: 'failed', error: '渠道 500' }, new Date('2026-10-02T08:02:00Z'));
  assert.equal(d2.attemptCount, 2);
  assert.equal(d2.nextAttemptAt.toISOString(), '2026-10-02T08:06:00.000Z', '第 2 次失败退避 2^2 分钟');

  recordDeliveryAttempt(d2, { outcome: 'sent' }, new Date('2026-10-02T08:04:00Z'));
  assert.equal(d2.status, 'sent');
  assert.ok(d2.sentAt);
  assert.throws(() => resetDeliveryForManualRetry(d2, now), (e) => e.code === 'DELIVERY_NOT_RETRYABLE', 'sent 不可手工重试');

  // 失败达上限停（maxAttempts=2）
  const n3 = Notification.create({ recipientUserId: randomUUID(), eventType: 'e', title: 't', body: 'b', reference: {}, idempotencyKey: 'k3' }, now);
  const d3 = n3.state.deliveries[0];
  d3.maxAttempts = 2;
  recordDeliveryAttempt(d3, { outcome: 'failed', error: 'x' }, now);
  recordDeliveryAttempt(d3, { outcome: 'failed', error: 'x' }, now);
  assert.equal(d3.attemptCount, 2);
  assert.equal(d3.status, 'failed');
  // 达上限后仍可手工重试（重置计数）
  resetDeliveryForManualRetry(d3, now);
  assert.equal(d3.status, 'pending');
  assert.equal(d3.attemptCount, 0);
  assert.equal(d3.lastError, null);
});

// ================= 管道与扫描（真实 PG） =================

test('T009 F038 管道：幂等创建/并发恰一/投递驱动 skipped/手工重试与审计', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t009_notif_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t009_notif_test');
  let closeDb = async () => {};
  context.after(async () => {
    await closeDb();
    await admin.end();
    if (process.env.PINDIAN_KEEP_TEST_DB !== '1') {
      const cleanup = new pg.Client({ connectionString: database.adminUrl });
      await cleanup.connect();
      await cleanup.query('DROP DATABASE IF EXISTS pindian_t009_notif_test WITH (FORCE)').catch(() => {});
      await cleanup.end();
    }
  });

  await new Promise((res, rej) => {
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? res('') : rej(new Error('迁移失败'))));
  });

  const { PostgresNotificationRepository } = require('../../../backend/dist/contexts/notifications/adapters/outbound/postgres/notification-repository.js');
  const { UnconfiguredChannelAdapter } = require('../../../backend/dist/contexts/notifications/adapters/outbound/channel/unconfigured-channel.js');
  const { RecordNotification } = require('../../../backend/dist/contexts/notifications/application/record-notification.js');
  const { DriveDeliveries } = require('../../../backend/dist/contexts/notifications/application/delivery-driver.js');
  const { RetryDelivery } = require('../../../backend/dist/contexts/notifications/application/retry-delivery.js');
  const { RecordOperation } = require('../../../backend/dist/contexts/audit/application');
  const { PostgresOperationLogRepository } = require('../../../backend/dist/contexts/audit/adapters/outbound/postgres/operation-log-repository.js');

  const db = new pg.Pool({ connectionString: database.testUrl });
  closeDb = async () => { await db.end().catch(() => {}); };
  const repo = new PostgresNotificationRepository(db);
  const recorder = new RecordNotification({ repository: repo, clock: { now: () => new Date() } });
  const userId = randomUUID();
  await db.query(`INSERT INTO users (id, nickname, status) VALUES ($1, '通知用户', 'active')`, [userId]);

  await context.test('幂等创建：同键返回同通知且无新投递', async () => {
    const first = await recorder.execute({ recipientUserId: userId, eventType: 'group.succeeded', title: '拼单成功', body: 'b', reference: { orderId: 'o1' }, idempotencyKey: 'group.succeeded:o1' });
    assert.equal(first.duplicated, false);
    const second = await recorder.execute({ recipientUserId: userId, eventType: 'group.succeeded', title: '拼单成功', body: 'b', reference: { orderId: 'o1' }, idempotencyKey: 'group.succeeded:o1' });
    assert.equal(second.duplicated, true);
    assert.equal(second.notification.state.notificationId, first.notification.state.notificationId);
    const count = await db.query('SELECT COUNT(*)::int c FROM notification_deliveries');
    assert.equal(count.rows[0].c, 1, '同键重复创建不新增投递');
  });

  await context.test('并发同键：真实 PG 双写恰一条', async () => {
    const key = `group.succeeded:${randomUUID()}`;
    const [a, b] = await Promise.all([
      recorder.execute({ recipientUserId: userId, eventType: 'group.succeeded', title: 't', body: 'b', reference: {}, idempotencyKey: key }),
      recorder.execute({ recipientUserId: userId, eventType: 'group.succeeded', title: 't', body: 'b', reference: {}, idempotencyKey: key })
    ]);
    assert.equal(a.notification.state.notificationId, b.notification.state.notificationId, '并发同键归一');
    const count = await db.query('SELECT COUNT(*)::int c FROM notifications WHERE idempotency_key=$1', [key]);
    assert.equal(count.rows[0].c, 1);
  });

  await context.test('投递驱动：未配置渠道 → skipped 终态（D021）', async () => {
    const driver = new DriveDeliveries({ repository: repo, channels: [new UnconfiguredChannelAdapter()], clock: { now: () => new Date() } });
    const result = await driver.execute({ limit: 10 });
    assert.ok(result.processed >= 2, `驱动了待投递记录（实际 ${result.processed}）`);
    const rows = await db.query(`SELECT status, skipped_reason FROM notification_deliveries WHERE status='skipped'`);
    assert.ok(rows.rows.length >= 2);
    assert.ok(rows.rows.every((r) => r.skipped_reason === 'channel_not_configured'));
    const before = await db.query('SELECT COUNT(*)::int c FROM notification_deliveries WHERE status=$1', ['skipped']);
    await driver.execute({ limit: 10 });
    const after = await db.query('SELECT COUNT(*)::int c FROM notification_deliveries WHERE status=$1', ['skipped']);
    assert.equal(after.rows[0].c, before.rows[0].c, 'skipped 终态不被重复驱动');
  });

  await context.test('投递驱动：失败退避重试至上限，手工重试与审计', async () => {
    const failing = { channel: 'wechat_subscribe_message', send: async () => ({ outcome: 'failed', error: '渠道 500' }) };
    const clockNow = { current: new Date('2026-10-02T08:00:00Z') };
    const clock = { now: () => clockNow.current };
    const driver = new DriveDeliveries({ repository: repo, channels: [failing], clock });
    const created = await recorder.execute({ recipientUserId: userId, eventType: 'refund.succeeded', title: '退款到账', body: 'b', reference: { refundId: 'r1' }, idempotencyKey: 'refund.succeeded:r1' });
    const notificationId = created.notification.state.notificationId;

    // 第 1 轮：失败，attempt=1，退避 2 分钟
    await driver.execute({ limit: 10 });
    let row = (await db.query('SELECT status, attempt_count, next_attempt_at FROM notification_deliveries WHERE notification_id=$1', [notificationId])).rows[0];
    assert.equal(row.status, 'failed');
    assert.equal(row.attempt_count, 1);
    assert.equal(new Date(row.next_attempt_at).toISOString(), '2026-10-02T08:02:00.000Z');

    // 未到期不重试
    clockNow.current = new Date('2026-10-02T08:01:00Z');
    await driver.execute({ limit: 10 });
    row = (await db.query('SELECT attempt_count FROM notification_deliveries WHERE notification_id=$1', [notificationId])).rows[0];
    assert.equal(row.attempt_count, 1, '退避期内不重试');

    // 到期后第 2 次失败，attempt=2（未达上限 5）
    clockNow.current = new Date('2026-10-02T08:02:00Z');
    await driver.execute({ limit: 10 });
    row = (await db.query('SELECT attempt_count, status FROM notification_deliveries WHERE notification_id=$1', [notificationId])).rows[0];
    assert.equal(row.attempt_count, 2);

    // 手工重试：sent/skipped/pending 不可、failed 可
    const auditRepo = new PostgresOperationLogRepository(db);
    const audit = new RecordOperation({ repository: auditRepo, clock });
    const retry = new RetryDelivery({ repository: repo, audit, clock });
    const skippedId = (await db.query(`SELECT id FROM notification_deliveries WHERE status='skipped' LIMIT 1`)).rows[0].id;
    await assert.rejects(() => retry.execute({ deliveryId: skippedId, adminId: null, requestId: 'r' }), (e) => e.code === 'DELIVERY_NOT_RETRYABLE', 'skipped 终态不可手工重试');

    // 到期后再驱动失败一次 → 仍 failed，可手工重置
    clockNow.current = new Date('2026-10-02T08:04:00Z');
    await driver.execute({ limit: 10 });
    const deliveryId = (await db.query('SELECT id FROM notification_deliveries WHERE notification_id=$1', [notificationId])).rows[0].id;
    const failedRow = (await db.query('SELECT status FROM notification_deliveries WHERE id=$1', [deliveryId])).rows[0];
    assert.equal(failedRow.status, 'failed');
    const reset = await retry.execute({ deliveryId, adminId: null, requestId: 'req-1' });
    assert.equal(reset.delivery.status, 'pending');
    assert.equal(reset.delivery.attemptCount, 0);
    const auditRows = await db.query(`SELECT COUNT(*)::int c FROM admin_operation_logs WHERE action='notification.retry' AND resource_id=$1`, [deliveryId]);
    assert.equal(auditRows.rows[0].c, 1, '手工重试写审计');
  });
});

test('T009 F038 扫描：超时提醒与业务事件补抓（幂等）', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t009_scan_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t009_scan_test');
  let closeDb = async () => {};
  context.after(async () => {
    await closeDb();
    await admin.end();
    if (process.env.PINDIAN_KEEP_TEST_DB !== '1') {
      const cleanup = new pg.Client({ connectionString: database.adminUrl });
      await cleanup.connect();
      await cleanup.query('DROP DATABASE IF EXISTS pindian_t009_scan_test WITH (FORCE)').catch(() => {});
      await cleanup.end();
    }
  });
  await new Promise((res, rej) => {
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: urlOf('pindian_t009_scan_test') }, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? res('') : rej(new Error('迁移失败'))));
  });

  const { PostgresNotificationRepository } = require('../../../backend/dist/contexts/notifications/adapters/outbound/postgres/notification-repository.js');
  const { PostgresNotificationScanPort } = require('../../../backend/dist/contexts/notifications/adapters/outbound/postgres/scan-ports.js');
  const { RecordNotification } = require('../../../backend/dist/contexts/notifications/application/record-notification.js');
  const { ScanTimeoutConversations } = require('../../../backend/dist/contexts/notifications/application/timeout-reminder.js');
  const { CatchUpBusinessEvents } = require('../../../backend/dist/contexts/notifications/application/event-catchup.js');

  const db = new pg.Pool({ connectionString: urlOf('pindian_t009_scan_test') });
  closeDb = async () => { await db.end().catch(() => {}); };
  const repo = new PostgresNotificationRepository(db);
  const recorder = new RecordNotification({ repository: repo, clock: { now: () => new Date() } });
  const scanPort = new PostgresNotificationScanPort(db);

  // 种子
  const U = randomUUID();
  await db.query(`INSERT INTO users (id, nickname, status) VALUES ($1, '扫描用户', 'active')`, [U]);
  const SUPER_ONLINE = randomUUID();
  const SUPER_OFFLINE = randomUUID();
  await db.query(`INSERT INTO admins (id, username, display_name, password_hash, role, status) VALUES ($1,'sup1','主管一','x','cs_supervisor','active'), ($2,'sup2','主管二','x','cs_supervisor','active')`, [SUPER_ONLINE, SUPER_OFFLINE]);
  await db.query(`INSERT INTO cs_agent_presence (agent_id, heartbeat_at) VALUES ($1, now())`, [SUPER_ONLINE]);
  const P = randomUUID();
  await db.query(`INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status) VALUES ($1,'扫描苹果',50000,10,'斤',ARRAY[30,20,15,12],'on_shelf')`, [P]);
  const G = randomUUID();
  await db.query(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units) VALUES ($1,$2,'{}', now()+interval '1 day','success',60)`, [G, P]);

  const overdueConv = randomUUID();
  const freshConv = randomUUID();
  const answeredConv = randomUUID();
  const endedConv = randomUUID();
  const U2 = randomUUID();
  const U3 = randomUUID();
  await db.query(`INSERT INTO users (id, nickname, status) VALUES ($1, '扫描用户二', 'active'), ($2, '扫描用户三', 'active')`, [U2, U3]);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at) VALUES ($1,$2,'active', now() - interval '20 minutes')`, [overdueConv, U]);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at) VALUES ($1,$2,'queued', now() - interval '5 minutes')`, [freshConv, U2]);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at) VALUES ($1,$2,'active', now() - interval '30 minutes')`, [answeredConv, U3]);
  await db.query(`INSERT INTO cs_messages (conversation_id, seq, sender, kind, content, internal, client_message_id) VALUES ($1,1,'agent','text','{"text":"在的"}',false,'a1')`, [answeredConv]);
  await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at) VALUES ($1,$2,'ended', now() - interval '40 minutes')`, [endedConv, U]);

  const reminder = new ScanTimeoutConversations({ scanPort, recorder, clock: { now: () => new Date() }, thresholdMinutes: 15 });

  await context.test('超时提醒：仅超时未首响会话 × 在线主管，幂等', async () => {
    const first = await reminder.execute({ limit: 100 });
    assert.equal(first.created, 1, `恰好一条提醒（在线主管×超时会话，实际 ${first.created}）`);
    const rows = await db.query(`SELECT recipient_admin_id, idempotency_key FROM notifications WHERE event_type='cs.conversation.timeout'`);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].recipient_admin_id, SUPER_ONLINE, '只提醒在线主管（离线主管不提醒，且非空场景不落 fallback）');
    assert.equal(rows.rows[0].idempotency_key, `cs.conversation.timeout:${overdueConv}:${SUPER_ONLINE}`);
    const second = await reminder.execute({ limit: 100 });
    assert.equal(second.created, 0, '二次扫描不重复提醒');
  });

  await context.test('业务事件补抓：退款成功与拼单成功逐单通知，幂等', async () => {
    const orderA = randomUUID();
    const orderB = randomUUID();
    await db.query(
      `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, original_price_fen, unit, whole_quantity_text, reference_quantity_text,
        address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at)
       VALUES ($1,'PO-SCAN-A',$2,$3,$4,30,'paid',25250,25000,250,50000,'斤','10','10','收','13800001230','广东省','深圳市','南山区','地址',$5, now()+interval '1 hour', now())`,
      [orderA, U, P, G, randomUUID()]
    );
    await db.query(
      `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, original_price_fen, unit, whole_quantity_text, reference_quantity_text,
        address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at)
       VALUES ($1,'PO-SCAN-B',$2,$3,$4,30,'paid',25250,25000,250,50000,'斤','10','10','收','13800001230','广东省','深圳市','南山区','地址',$5, now()+interval '1 hour', now())`,
      [orderB, U, P, G, randomUUID()]
    );
    const refundId = randomUUID();
    const paymentId = randomUUID();
    await db.query(`INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, applied_result) VALUES ($1,$2,$3,25250,'succeeded','SCAN-PAY','applied')`, [paymentId, orderA, U]);
    await db.query(`INSERT INTO refunds (id, payment_id, order_id, user_id, out_refund_no, amount_fen, status, reason) VALUES ($1,$2,$3,$4,'SCAN-REFUND',25250,'succeeded','user_cancel')`, [refundId, paymentId, orderA, U]);

    const catchup = new CatchUpBusinessEvents({ scanPort, recorder });
    const first = await catchup.execute({ limit: 100 });
    assert.equal(first.created, 3, `拼单成功 2 条 + 退款到账 1 条（实际 ${first.created}）`);
    const userNotes = await db.query(`SELECT idempotency_key FROM notifications WHERE recipient_user_id=$1 ORDER BY idempotency_key`, [U]);
    const keys = userNotes.rows.map((r) => r.idempotency_key);
    assert.ok(keys.includes(`refund.succeeded:${refundId}`));
    assert.ok(keys.includes(`group.succeeded:${orderA}`));
    assert.ok(keys.includes(`group.succeeded:${orderB}`));
    const second = await catchup.execute({ limit: 100 });
    assert.equal(second.created, 0, '二次补抓不重复');
  });
});

function urlOf(dbName) {
  const u = new URL(database.adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}
