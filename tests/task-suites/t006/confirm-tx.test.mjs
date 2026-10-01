import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const dist = (rel) => pathToFileURL(join(root, 'backend/dist', rel)).href;

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
  url.pathname = '/pindian_t006_tx_test';
  return { adminUrl: envUrl, testUrl: url.toString() };
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

// 第三轮（第二轮独立复验 A03）：生产仓储 + 真实 BEGIN/ROLLBACK 的故障回归。
// 不用任何 Fake 手动恢复：故障后支付状态必须由数据库回滚恢复原态。
test('确认工作流生产事务：退款建单失败回滚支付状态；恢复后重放恰一笔退款（A03/AC04）', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t006_tx_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t006_tx_test');
  context.after(async () => { await admin.end(); });

  await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`迁移失败：${out}`))));
  });

  const { ConfirmPaymentWorkflow } = await import(dist('workflows/payment-confirm.workflow.js'));
  const { CreateFullRefundUseCase } = await import(dist('contexts/payments/application/refund-flow.js'));
  const { PostgresPaymentRepository } = await import(dist('contexts/payments/adapters/outbound/postgres/payment-repository.js'));
  const { PostgresRefundRepository } = await import(dist('contexts/payments/adapters/outbound/postgres/refund-repository.js'));
  const { PostgresGroupRepository, PostgresShareReservationRepository } = await import(dist('contexts/group-buying/adapters/outbound/postgres/group-repositories.js'));
  const { PostgresOrderRepository } = await import(dist('contexts/ordering/adapters/outbound/postgres/order-repository.js'));
  const { getStockReservationPort } = await import(dist('contexts/catalog/adapters/outbound/catalog-stock-adapters.js'));
  const { PostgresTransactionRunner } = await import(dist('adapters-shared/transaction-runner.js'));

  const pool = new pg.Pool({ connectionString: database.testUrl, max: 4 });
  context.after(async () => { await pool.end(); });
  const db = (sql, params) => pool.query(sql, params);
  const payments = new PostgresPaymentRepository(pool);
  const refunds = new PostgresRefundRepository(pool);
  const groups = new PostgresGroupRepository(pool);
  const reservations = new PostgresShareReservationRepository(pool);
  const orders = new PostgresOrderRepository(pool);
  const stocks = getStockReservationPort(pool);
  const runner = new PostgresTransactionRunner(pool);
  const clock = { now: () => new Date() };
  const refundCreator = new CreateFullRefundUseCase({ refunds, payments, clock });

  const buildWorkflow = (refundsPort, groupsPort = groups) => new ConfirmPaymentWorkflow({
    groups: groupsPort, reservations, orders, payments,
    refunds: { createFullRefund: (input, sessionTx) => refundCreator.execute(input, sessionTx) },
    stocks, runner, clock
  });

  // ---- 种子（测试库直插，不触主库）----
  const USER = 'aaaaaaaa-3333-4333-8333-000000000001';
  const PRODUCT = 'cccccccc-3333-4333-8333-000000000002';
  const GROUP = 'eeeeeeee-3333-4333-8333-000000000003';
  const ORDER = 'bbbbbbbb-3333-4333-8333-000000000004';
  const SNAPSHOT = JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' });
  await db(`INSERT INTO users (id, nickname, status) VALUES ($1, 'tx用户', 'active')`, [USER]);
  await db(`INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status, group_deadline_hours)
            VALUES ($1, 'tx苹果', 50000, 10, '斤', ARRAY[30,20,15,12], 'on_shelf', 24)`, [PRODUCT]);
  await db(`INSERT INTO stocks (product_id, available_whole_items) VALUES ($1, 3)`, [PRODUCT]);
  await db(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, reserved_units, paid_units)
            VALUES ($1, $2, $3, now() + interval '24 hours', 'open', 0, 0)`, [GROUP, PRODUCT, SNAPSHOT]);
  await db(`INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, tail_adjust_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text, address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at)
            VALUES ($1, 'PO-TX-1', $2, $3, $4, 20, 'expired', 16833, 16667, 166, 0, false, 50000, '斤', '10', '3.333', '张三', '13800001234', '广东省', '深圳市', '南山区', 'tx 1 号', $5, now() - interval '1 minute')`,
    [ORDER, USER, PRODUCT, GROUP, randomUUID()]);
  await db(`INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, prepay_id)
            VALUES ($1, $2, $3, 16833, 'processing', $4, 'prep-tx-1')`, [randomUUID(), ORDER, USER, ORDER]);

  const fact = { outTradeNo: ORDER, channelTransactionId: 'wx-tx-probe-1', payerTotal: 16833, payload: { probe: true } };
  const paymentRow = async () => (await db('SELECT status, applied_result FROM payments WHERE order_id = $1', [ORDER])).rows[0];
  const refundCount = async () => (await db('SELECT COUNT(*)::int AS c FROM refunds WHERE order_id = $1', [ORDER])).rows[0].c;

  // ---- 第 1 步：注入退款建单失败（生产工作流 + 真实 BEGIN/ROLLBACK）----
  const failingRefunds = {
    findByPaymentId: refunds.findByPaymentId.bind(refunds),
    insert: async () => { throw new Error('注入：退款建单失败'); }
  };
  const failingCreator = new CreateFullRefundUseCase({ refunds: failingRefunds, payments, clock });
  const failingWorkflow = new ConfirmPaymentWorkflow({
    groups, reservations, orders, payments,
    refunds: { createFullRefund: (input, sessionTx) => failingCreator.execute(input, sessionTx) },
    stocks, runner, clock
  });
  await assert.rejects(() => failingWorkflow.execute({ channelFact: fact, source: 'callback' }), /注入：退款建单失败/);

  // ---- 第 2 步：支付状态必须由数据库回滚恢复为 processing（A03 生产证据）----
  const afterFailure = await paymentRow();
  assert.equal(afterFailure.status, 'processing', `回滚后支付单应停留 processing（实际 ${afterFailure.status}）`);
  assert.equal(afterFailure.applied_result, null, '回滚后不残留 applied_result');
  assert.equal(await refundCount(), 0, '回滚后无退款单');

  // ---- 第 3 步：故障恢复后重放同一事实 → 恰好一笔全额退款 ----
  const workflow = buildWorkflow();
  const replay = await workflow.execute({ channelFact: fact, source: 'callback' });
  assert.equal(replay, false);
  const afterReplay = await paymentRow();
  assert.equal(afterReplay.status, 'succeeded');
  assert.equal(afterReplay.applied_result, 'refunded_not_applied');
  assert.equal(await refundCount(), 1, '恢复后重放恰好一笔退款');
  const refund1 = (await db('SELECT amount_fen, reason, status FROM refunds WHERE order_id = $1', [ORDER])).rows[0];
  assert.equal(refund1.amount_fen, 16833, '全额（含服务费）');
  assert.equal(refund1.reason, 'late_payment');
  assert.equal(refund1.status, 'requested');

  // ---- 第 4 步：再次重放不重复处理（succeeded 早退）----
  const secondReplay = await workflow.execute({ channelFact: { ...fact, channelTransactionId: 'wx-tx-probe-1' }, source: 'callback' });
  assert.equal(secondReplay, true, '重复回调幂等返回');
  assert.equal(await refundCount(), 1, '不重复建退款');
});

test('库存端口生产事务：组成功落账失败 → 整件消耗随外层回滚（R12）', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t006_tx_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t006_tx_test');
  context.after(async () => { await admin.end(); });

  await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`迁移失败：${out}`))));
  });

  const { ConfirmPaymentWorkflow } = await import(dist('workflows/payment-confirm.workflow.js'));
  const { CreateFullRefundUseCase } = await import(dist('contexts/payments/application/refund-flow.js'));
  const { PostgresPaymentRepository } = await import(dist('contexts/payments/adapters/outbound/postgres/payment-repository.js'));
  const { PostgresRefundRepository } = await import(dist('contexts/payments/adapters/outbound/postgres/refund-repository.js'));
  const { PostgresGroupRepository, PostgresShareReservationRepository } = await import(dist('contexts/group-buying/adapters/outbound/postgres/group-repositories.js'));
  const { PostgresOrderRepository } = await import(dist('contexts/ordering/adapters/outbound/postgres/order-repository.js'));
  const { getStockReservationPort } = await import(dist('contexts/catalog/adapters/outbound/catalog-stock-adapters.js'));
  const { PostgresTransactionRunner } = await import(dist('adapters-shared/transaction-runner.js'));

  const pool = new pg.Pool({ connectionString: database.testUrl, max: 4 });
  context.after(async () => { await pool.end(); });
  const db = (sql, params) => pool.query(sql, params);
  const payments = new PostgresPaymentRepository(pool);
  const refunds = new PostgresRefundRepository(pool);
  const groups = new PostgresGroupRepository(pool);
  const reservations = new PostgresShareReservationRepository(pool);
  const orders = new PostgresOrderRepository(pool);
  const stocks = getStockReservationPort(pool);
  const runner = new PostgresTransactionRunner(pool);
  const clock = { now: () => new Date() };

  // 组 paid 40 + 预占 20 生效 → 组满成功 → 消耗整件 + 落账（注入落账失败）
  const USER = 'aaaaaaaa-3333-4333-8333-000000000011';
  const PRODUCT = 'cccccccc-3333-4333-8333-000000000012';
  const GROUP = 'eeeeeeee-3333-4333-8333-000000000013';
  const ORDER = 'bbbbbbbb-3333-4333-8333-000000000014';
  const RES = 'ffffffff-3333-4333-8333-000000000015';
  const SNAPSHOT = JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' });
  await db(`INSERT INTO users (id, nickname, status) VALUES ($1, 'tx用户2', 'active')`, [USER]);
  await db(`INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status, group_deadline_hours)
            VALUES ($1, 'tx苹果2', 50000, 10, '斤', ARRAY[30,20,15,12], 'on_shelf', 24)`, [PRODUCT]);
  await db(`INSERT INTO stocks (product_id, available_whole_items, reserved_whole_items) VALUES ($1, 2, 1)`, [PRODUCT]);
  await db(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, reserved_units, paid_units, paid_amount_fen, paid_goods_amount_fen)
            VALUES ($1, $2, $3, now() + interval '24 hours', 'open', 20, 40, 33666, 33334)`, [GROUP, PRODUCT, SNAPSHOT]);
  await db(`INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, tail_adjust_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text, address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at)
            VALUES ($1, 'PO-TX-2', $2, $3, $4, 20, 'unpaid', 16833, 16667, 166, 0, false, 50000, '斤', '10', '3.333', '张三', '13800001234', '广东省', '深圳市', '南山区', 'tx 2 号', $5, now() + interval '10 minutes')`,
    [ORDER, USER, PRODUCT, GROUP, randomUUID()]);
  await db(`INSERT INTO share_reservations (id, group_id, order_id, units, status, expires_at) VALUES ($1, $2, $3, 20, 'reserved', now() + interval '10 minutes')`, [RES, GROUP, ORDER]);
  await db(`INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, prepay_id)
            VALUES ($1, $2, $3, 16833, 'processing', $4, 'prep-tx-2')`, [randomUUID(), ORDER, USER, ORDER]);

  const movementCount = async () => (await db(`SELECT COUNT(*)::int AS c FROM stock_movements WHERE business_key = $1`, [`group-consume:${GROUP}`])).rows[0].c;
  const stockRow = async () => (await db('SELECT available_whole_items AS a, reserved_whole_items AS r FROM stocks WHERE product_id = $1', [PRODUCT])).rows[0];

  // 注入：recordSettlement（消耗之后、事务内最后一步）失败
  const failingGroups = Object.create(groups);
  failingGroups.recordSettlement = async () => { throw new Error('注入：结算落账失败'); };
  const workflow = new ConfirmPaymentWorkflow({
    groups: failingGroups, reservations, orders, payments,
    refunds: { createFullRefund: (input, sessionTx) => new CreateFullRefundUseCase({ refunds, payments, clock }).execute(input, sessionTx) },
    stocks, runner, clock
  });
  await assert.rejects(
    () => workflow.execute({ channelFact: { outTradeNo: ORDER, channelTransactionId: 'wx-tx-probe-2', payerTotal: 16833 }, source: 'callback' }),
    /注入：结算落账失败/
  );

  // 外层回滚：订单/预占/组/支付/库存（含 movement）全部恢复原态
  const stock = await stockRow();
  assert.deepEqual([Number(stock.a), Number(stock.r)], [2, 1], '整件消耗随事务回滚（不残留消耗）');
  assert.equal(await movementCount(), 0, '消耗台账随事务回滚');
  assert.equal((await db('SELECT status FROM orders WHERE id = $1', [ORDER])).rows[0].status, 'unpaid', '订单回滚为 unpaid');
  assert.equal((await db('SELECT status FROM share_reservations WHERE id = $1', [RES])).rows[0].status, 'reserved', '预占回滚为 reserved');
  assert.equal((await db('SELECT paid_units FROM groups WHERE id = $1', [GROUP])).rows[0].paid_units, 40, '组容量回滚');
  const payment = (await db('SELECT status FROM payments WHERE order_id = $1', [ORDER])).rows[0];
  assert.equal(payment.status, 'processing', '支付单回滚为 processing');

  // 恢复后重放：组成功、消耗与台账恰好一次
  const okWorkflow = new ConfirmPaymentWorkflow({
    groups, reservations, orders, payments,
    refunds: { createFullRefund: (input, sessionTx) => new CreateFullRefundUseCase({ refunds, payments, clock }).execute(input, sessionTx) },
    stocks, runner, clock
  });
  const applied = await okWorkflow.execute({ channelFact: { outTradeNo: ORDER, channelTransactionId: 'wx-tx-probe-2', payerTotal: 16833 }, source: 'query' });
  assert.equal(applied, true);
  const stockAfter = await stockRow();
  assert.deepEqual([Number(stockAfter.a), Number(stockAfter.r)], [2, 0], '重放消耗一次：reserved 1→0');
  assert.equal(await movementCount(), 1, '消耗台账恰好一条');
  assert.equal((await db('SELECT status FROM groups WHERE id = $1', [GROUP])).rows[0].status, 'success');
});


test('并发支付确认 exactly-once：回调与查单同时确认不误退款（第四轮 P1-1）', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t006_tx_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t006_tx_test');
  context.after(async () => { await admin.end(); });

  await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`迁移失败：${out}`))));
  });

  const { ConfirmPaymentWorkflow } = await import(dist('workflows/payment-confirm.workflow.js'));
  const { CreateFullRefundUseCase } = await import(dist('contexts/payments/application/refund-flow.js'));
  const { PostgresPaymentRepository } = await import(dist('contexts/payments/adapters/outbound/postgres/payment-repository.js'));
  const { PostgresRefundRepository } = await import(dist('contexts/payments/adapters/outbound/postgres/refund-repository.js'));
  const { PostgresGroupRepository, PostgresShareReservationRepository } = await import(dist('contexts/group-buying/adapters/outbound/postgres/group-repositories.js'));
  const { PostgresOrderRepository } = await import(dist('contexts/ordering/adapters/outbound/postgres/order-repository.js'));
  const { getStockReservationPort } = await import(dist('contexts/catalog/adapters/outbound/catalog-stock-adapters.js'));
  const { PostgresTransactionRunner } = await import(dist('adapters-shared/transaction-runner.js'));

  const pool = new pg.Pool({ connectionString: database.testUrl, max: 6 });
  context.after(async () => { await pool.end(); });
  const db = (sql, params) => pool.query(sql, params);
  const payments = new PostgresPaymentRepository(pool);
  const refunds = new PostgresRefundRepository(pool);
  const groups = new PostgresGroupRepository(pool);
  const reservations = new PostgresShareReservationRepository(pool);
  const orders = new PostgresOrderRepository(pool);
  const stocks = getStockReservationPort(pool);
  const runner = new PostgresTransactionRunner(pool);
  const clock = { now: () => new Date() };

  const USER = 'aaaaaaaa-3333-4333-8333-000000000021';
  const PRODUCT = 'cccccccc-3333-4333-8333-000000000022';
  const GROUP = 'eeeeeeee-3333-4333-8333-000000000023';
  const ORDER = 'bbbbbbbb-3333-4333-8333-000000000024';
  const RES = 'ffffffff-3333-4333-8333-000000000025';
  const SNAPSHOT = JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' });
  await db(`INSERT INTO users (id, nickname, status) VALUES ($1, '并发用户', 'active')`, [USER]);
  await db(`INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status, group_deadline_hours)
            VALUES ($1, '并发苹果', 50000, 10, '斤', ARRAY[30,20,15,12], 'on_shelf', 24)`, [PRODUCT]);
  await db(`INSERT INTO stocks (product_id, available_whole_items, reserved_whole_items) VALUES ($1, 1, 1)`, [PRODUCT]);
  // paid 40 + 并发确认 20 → 组满成功：并发下消耗与台账也必须恰好一次
  await db(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, reserved_units, paid_units, paid_amount_fen, paid_goods_amount_fen)
            VALUES ($1, $2, $3, now() + interval '24 hours', 'open', 20, 40, 33666, 33334)`, [GROUP, PRODUCT, SNAPSHOT]);
  await db(`INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, tail_adjust_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text, address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at)
            VALUES ($1, 'PO-TX-3', $2, $3, $4, 20, 'unpaid', 16833, 16667, 166, 0, false, 50000, '斤', '10', '3.333', '张三', '13800001234', '广东省', '深圳市', '南山区', 'tx 3 号', $5, now() + interval '10 minutes')`,
    [ORDER, USER, PRODUCT, GROUP, randomUUID()]);
  await db(`INSERT INTO share_reservations (id, group_id, order_id, units, status, expires_at) VALUES ($1, $2, $3, 20, 'reserved', now() + interval '10 minutes')`, [RES, GROUP, ORDER]);
  await db(`INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, prepay_id)
            VALUES ($1, $2, $3, 16833, 'processing', $4, 'prep-tx-3')`, [randomUUID(), ORDER, USER, ORDER]);

  const workflow = new ConfirmPaymentWorkflow({
    groups, reservations, orders, payments,
    refunds: { createFullRefund: (input, sessionTx) => new CreateFullRefundUseCase({ refunds, payments, clock }).execute(input, sessionTx) },
    stocks, runner, clock
  });
  const fact = { outTradeNo: ORDER, channelTransactionId: 'wx-tx-concurrent-1', payerTotal: 16833 };

  // 回调与查单并发确认（同一支付事实，两个生产工作流实例并行）
  const [callbackResult, queryResult] = await Promise.all([
    workflow.execute({ channelFact: fact, source: 'callback' }),
    workflow.execute({ channelFact: fact, source: 'query' })
  ]);

  // 恰好一方生效、另一方幂等成功——不允许 false/退款路径
  assert.deepEqual([callbackResult, queryResult].sort(), [true, true], '并发双方都应返回成功（一方应用、一方幂等）');
  const payment = (await db('SELECT status, applied_result FROM payments WHERE order_id = $1', [ORDER])).rows[0];
  assert.equal(payment.status, 'succeeded');
  assert.equal(payment.applied_result, 'applied', '并发不得把 applied 改写为 refunded_not_applied');
  const refundCount = (await db('SELECT COUNT(*)::int AS c FROM refunds WHERE order_id = $1', [ORDER])).rows[0].c;
  assert.equal(refundCount, 0, '并发确认不得创建退款');
  assert.equal((await db('SELECT paid_units FROM groups WHERE id = $1', [GROUP])).rows[0].paid_units, 60, '容量只加一次（40+60）');
  assert.equal((await db('SELECT status FROM orders WHERE id = $1', [ORDER])).rows[0].status, 'paid');
  assert.equal((await db('SELECT status FROM share_reservations WHERE id = $1', [RES])).rows[0].status, 'converted', '预占仅转换一次');
  const stock = (await db('SELECT available_whole_items AS a, reserved_whole_items AS r FROM stocks WHERE product_id = $1', [PRODUCT])).rows[0];
  assert.deepEqual([Number(stock.a), Number(stock.r)], [1, 0], '组成功整件消耗恰好一次');
  assert.equal((await db(`SELECT COUNT(*)::int AS c FROM stock_movements WHERE business_key = $1`, [`group-consume:${GROUP}`])).rows[0].c, 1, '消耗台账恰好一条');
  assert.equal((await db('SELECT COUNT(*)::int AS c FROM group_settlements WHERE group_id = $1', [GROUP])).rows[0].c, 1, '让利台账恰好一条');
  assert.equal((await db('SELECT paid_units FROM groups WHERE id = $1', [GROUP])).rows[0].paid_units, 60, '组满成功');
});
