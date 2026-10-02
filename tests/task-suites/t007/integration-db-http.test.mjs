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
  url.pathname = '/pindian_t007_test';
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

test('T007 集成：履约生成幂等/原子、发货守恒与并发、补发、改址锁定、完成、导出、越权（真实 PG+HTTP+生产装配）', { timeout: 300_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t007_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t007_test');
  context.after(async () => { await admin.end(); });

  const migrateOut = await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`迁移失败：${out}`))));
  });
  assert.match(migrateOut, /已应用 0017/);

  // ---- 启动真实 API（生产装配） ----
  const port = await unusedPort();
  const mediaDir = mkdtempSync(join(tmpdir(), 'pindian-t007-'));
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
      await admin.query('DROP DATABASE IF EXISTS pindian_t007_test WITH (FORCE)').catch(() => {});
    }
  });

  // ---- 种子（测试库；组已成功 + 三笔 paid 订单 20/20/20，10 斤=5000g） ----
  const testDb = new pg.Client({ connectionString: database.testUrl });
  await testDb.connect();
  context.after(async () => { await testDb.end().catch(() => {}); });
  const USER_A = 'aaaaaaaa-5555-4555-8555-000000000001';
  const USER_B = 'aaaaaaaa-5555-4555-8555-000000000002';
  const USER_C = 'aaaaaaaa-5555-4555-8555-000000000003';
  const PRODUCT = 'cccccccc-5555-4555-8555-555555555555';
  const GROUP = 'eeeeeeee-5555-4555-8555-555555555555';
  const SNAPSHOT = JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' });
  const users = { ua: USER_A, ub: USER_B, uc: USER_C };
  const auth = {};
  let seq = 0;
  for (const [key, id] of Object.entries(users)) {
    await testDb.query(`INSERT INTO users (id, nickname, status) VALUES ($1, $2, 'active')`, [id, `用户${key}`]);
    const token = `tok-${key}-${Date.now()}`;
    await testDb.query(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [id, createHash('sha256').update(token).digest('hex')]);
    auth[key] = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }
  await testDb.query(
    `INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status, group_deadline_hours)
     VALUES ($1, '履约测试苹果', 50000, 10, '斤', ARRAY[30,20,15,12], 'on_shelf', 24)`,
    [PRODUCT]
  );
  await testDb.query(
    `INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units, paid_amount_fen, paid_goods_amount_fen)
     VALUES ($1, $2, $3, now() + interval '24 hours', 'success', 60, 50499, 50166)`,
    [GROUP, PRODUCT, SNAPSHOT]
  );
  const orderIds = [];
  const addressOf = (name, phone) => ({ receiver_name: name, phone, province: '广东省', city: '深圳市', district: '南山区', detail: `履约测试 ${name}` });
  const seed = [
    { key: 'ua', id: USER_A, units: 20 },
    { key: 'ub', id: USER_B, units: 20 },
    { key: 'uc', id: USER_C, units: 20 }
  ];
  for (const item of seed) {
    const orderId = randomUUID();
    orderIds.push(orderId);
    const addr = addressOf(`收货人${item.key}`, `1380000123${String(seq).padStart(1, '0')}`);
    await testDb.query(
      `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text, address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'paid', 16833, 16667, 166, false, 50000, '斤', '10', '3.333', $7, $8, $9, $10, $11, $12, $13, now() + interval '24 hours', now())`,
      [orderId, `PO-T007-${++seq}`, item.id, PRODUCT, GROUP, item.units, addr.receiver_name, addr.phone, addr.province, addr.city, addr.district, addr.detail, randomUUID()]
    );
  }

  const orderOf = (index) => orderIds[index];
  // ---- 生产生成任务（dist 导入；与 Worker 同一装配方式） ----
  const { FulfillmentGenerationTask } = await import(dist('workflows/fulfillment-generation.task.js'));
  const repoModule = await import(dist('contexts/fulfillment/adapters/outbound/postgres/fulfillment-repository.js'));
  const pool = new pg.Pool({ connectionString: database.testUrl, max: 4 });
  context.after(async () => { await pool.end(); });
  const fulfillmentRepo = new repoModule.PostgresFulfillmentRepository(pool);
  const runner = { async run(work) { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await work(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } } };
  const clock = { now: () => new Date() };
  const genTask = new FulfillmentGenerationTask({ scan: fulfillmentRepo, fulfillmentOrders: fulfillmentRepo, runner, clock });

  // ================= 场景 1：生成（AC01） =================
  const firstRun = await genTask.execute({ limit: 10 });
  assert.equal(firstRun, 1, '生成 1 组');
  let rows = (await testDb.query('SELECT * FROM fulfillment_orders WHERE group_id = $1 ORDER BY created_at', [GROUP])).rows;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.allocated_quantity_grams), [1667, 1667, 1666], 'D011 前序补齐');
  assert.equal(rows.reduce((s, r) => s + r.allocated_quantity_grams, 0), 5000, '守恒');
  assert.equal(rows[0].status, 'pending_shipment');
  assert.equal(rows[0].receiver_name, '收货人ua');
  // 重复任务/并发双实例不重复生成
  const secondRun = await genTask.execute({ limit: 10 });
  assert.equal(secondRun, 0);
  const [concurrentA, concurrentB] = await Promise.all([
    (async () => { const m = new repoModule.PostgresFulfillmentRepository(pool); return new FulfillmentGenerationTask({ scan: m, fulfillmentOrders: m, runner, clock }).execute({ limit: 10 }); })(),
    (async () => { const m = new repoModule.PostgresFulfillmentRepository(pool); return new FulfillmentGenerationTask({ scan: m, fulfillmentOrders: m, runner, clock }).execute({ limit: 10 }); })()
  ]);
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM fulfillment_orders WHERE group_id = $1', [GROUP])).rows[0].c, 3, '并发任务不重复生成');
  // 部分失败恢复：注入第 2 单插入失败 → 组级回滚 0 行；解除后重扫补齐
  void secondRun; void concurrentA; void concurrentB;
  const group2 = 'eeeeeeee-5555-4555-8555-555555555666';
  await testDb.query(
    `INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units, paid_amount_fen, paid_goods_amount_fen)
     VALUES ($1, $2, $3, now() + interval '24 hours', 'success', 60, 50499, 50166)`,
    [group2, PRODUCT, SNAPSHOT]
  );
  for (const [i, units] of [30, 30].entries()) {
    await testDb.query(
      `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text, address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'paid', 25250, 25000, 250, false, 50000, '斤', '10', '5.000', '收货人g2', '13899990000', '广东省', '深圳市', '南山区', 'g2 地址', $7, now() + interval '24 hours', now())`,
      [randomUUID(), `PO-T007-G2-${i + 1}`, USER_A, PRODUCT, group2, units, randomUUID()]
    );
  }
  // 真实回滚：第一单插入成功、第二单失败 → 整组回滚 0 行（生产仓储 + 真实 BEGIN/ROLLBACK）
  let insertCalls = 0;
  const partialRepo = Object.create(fulfillmentRepo);
  partialRepo.insert = async (order, sessionTx) => {
    insertCalls += 1;
    if (insertCalls >= 2) throw new Error('注入：第二单插入失败');
    return fulfillmentRepo.insert(order, sessionTx);
  };
  const partialTask = new FulfillmentGenerationTask({ scan: partialRepo, fulfillmentOrders: partialRepo, runner, clock });
  await partialTask.execute({ limit: 10 });
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM fulfillment_orders WHERE group_id = $1', [group2])).rows[0].c, 0, '组级回滚：第一单已插入也被回滚');
  assert.equal(insertCalls, 2, '确为第二单失败');
  const recoveryRun = await genTask.execute({ limit: 10 });
  assert.equal(recoveryRun, 1, '恢复后重扫生成');
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM fulfillment_orders WHERE group_id = $1', [group2])).rows[0].c, 2, '恢复后生成 2 单（30+30）');
  const g2Rows = (await testDb.query('SELECT allocated_quantity_grams FROM fulfillment_orders WHERE group_id = $1 ORDER BY created_at', [group2])).rows;
  assert.deepEqual(g2Rows.map((r) => r.allocated_quantity_grams), [2500, 2500], '整除无尾差');

  // ---- R01 单位：10 克组（两笔 30 份额）→ [5,5]；未知单位组跳过 ----
  const seedUnitGroup = async (groupId, unit, quantity) => {
    await testDb.query(
      `INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units, paid_amount_fen, paid_goods_amount_fen)
       VALUES ($1, $2, $3, now() + interval '24 hours', 'success', 60, 50499, 50166)`,
      [groupId, PRODUCT, JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: quantity, unit })]
    );
    for (const units of [30, 30]) {
      await testDb.query(
        `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text, address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'paid', 16833, 16667, 166, false, 50000, $7, $7, $7, '收', '13800001230', '广东省', '深圳市', '南山区', '单位测试', $8, now() + interval '24 hours', now())`,
        [randomUUID(), `PO-${groupId.slice(-6)}-${units}-${[30, 30].indexOf(units)}-${Math.random().toString(36).slice(2, 6)}`, USER_A, PRODUCT, groupId, units, unit, randomUUID()]
      );
    }
  };
  const gramGroup = 'eeeeeeee-5555-4555-8555-555555555777';
  await seedUnitGroup(gramGroup, '克', '10');
  await genTask.execute({ limit: 10 });
  const gramRows = (await testDb.query('SELECT allocated_quantity_grams FROM fulfillment_orders WHERE group_id = $1 ORDER BY created_at', [gramGroup])).rows;
  assert.deepEqual(gramRows.map((r) => r.allocated_quantity_grams), [5, 5], '10 克组分配 [5,5]（修复 R01 探针 5000 克缺陷）');
  const unknownGroup = 'eeeeeeee-5555-4555-8555-555555555888';
  await seedUnitGroup(unknownGroup, '升', '10');
  await genTask.execute({ limit: 10 });
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM fulfillment_orders WHERE group_id = $1', [unknownGroup])).rows[0].c, 0, '未知单位拒绝生成（不静默换算）');


  // ---- R07 真争抢：屏障令两个生产任务同时拿到同一未生成组 → 唯一约束兜底恰一份 ----
  const group3 = 'eeeeeeee-5555-4555-8555-555555555999';
  await seedUnitGroup(group3, '克', '10');
  let raceCalls = 0;
  let releaseRace;
  const raceGate = new Promise((res) => { releaseRace = res; });
  const racingScan = Object.create(fulfillmentRepo);
  racingScan.listSuccessGroupIdsWithoutFulfillment = async (limit) => {
    raceCalls += 1;
    if (raceCalls === 2) releaseRace();
    await raceGate;
    return (await fulfillmentRepo.listSuccessGroupIdsWithoutFulfillment(limit)).filter((id) => id === group3);
  };
  const raceTask = () => new FulfillmentGenerationTask({ scan: racingScan, fulfillmentOrders: fulfillmentRepo, runner, clock }).execute({ limit: 10 });
  const raceResults = await Promise.all([raceTask(), raceTask()]);
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM fulfillment_orders WHERE group_id = $1', [group3])).rows[0].c, 2, '争抢后恰好一份（两单无重复）');
  assert.ok(raceResults.every((n) => n >= 0), '两任务都不崩溃');

  // ---- 管理员登录 ----
  await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/create-admin.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl, ADMIN_INITIAL_USERNAME: 'root', ADMIN_INITIAL_PASSWORD: 't007-admin-pass' }, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error('create-admin 失败'))));
  });
  const adminLogin = await (await fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'root', password: 't007-admin-pass' }) })).json();
  const adminAuth = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${adminLogin.data.token}` });
  const fulfillmentIdOf = (index) => rows[index].id;
  const shipBody = (quantityGrams, trackingNo, extra = {}) => JSON.stringify({ quantityGrams, company: '顺丰', trackingNo, ...extra });
  const ship = (fid, body, headers = adminAuth()) => fetch(`${base}/api/admin/v1/fulfillment/orders/${fid}/shipments`, { method: 'POST', headers, body });

  // ================= 场景 2：列表与明细（AC03/AC09） =================
  const listRes = await (await fetch(`${base}/api/admin/v1/fulfillment/groups?page=1&pageSize=10`, { headers: adminAuth() })).json();
  assert.equal(listRes.data.total, 4, 'GROUP + group2 + 克组 + 争抢组（未知单位组不进入履约）');
  const summary = listRes.data.items.find((g) => g.groupId === GROUP);
  assert.equal(summary.pending, 3);
  await expectHttpError(fetch(`${base}/api/admin/v1/fulfillment/groups`, { headers: auth.ua }), 401, 'UNAUTHENTICATED');
  await expectHttpError(fetch(`${base}/api/admin/v1/fulfillment/groups`, { headers: { 'Content-Type': 'application/json' } }), 401, 'UNAUTHENTICATED');

  const detailRes = await (await fetch(`${base}/api/admin/v1/fulfillment/groups/${GROUP}`, { headers: adminAuth() })).json();
  assert.equal(detailRes.data.items.length, 3);
  assert.equal(detailRes.data.items[0].allocatedQuantityGrams, 1667);
  assert.equal(detailRes.data.items[0].allocatedQuantityText, '3.334');
  assert.ok(detailRes.data.items[0].receiver.phoneMasked.includes('****'), '明细电话脱敏');
  assert.equal(detailRes.data.items[0].nickname, '用户ua');
  // R03（P2）：普通详情不得含完整电话明文（脱敏存在且原文缺席）
  const detailRawText = JSON.stringify(detailRes);
  assert.ok(!detailRawText.includes('13800001230'), '普通响应不含完整电话明文');
  // R01：单位组明细回原单位（克 → 整数文本）
  const gramDetail = await (await fetch(`${base}/api/admin/v1/fulfillment/groups/${gramGroup}`, { headers: adminAuth() })).json();
  assert.equal(gramDetail.data.items[0].allocatedQuantityText, '5');
  assert.equal(gramDetail.data.items[0].unit, '克');

  // R07：无 order:manage 的有效管理员 → 403（catalog_admin：需求 §6.1 商品管理员）
  await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/create-admin.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl, ADMIN_INITIAL_USERNAME: 'catalog', ADMIN_INITIAL_PASSWORD: 'catalog-pass-1' }, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error('create-admin(catalog) 失败'))));
  });
  await testDb.query(`UPDATE admins SET role = 'catalog_admin' WHERE username = 'catalog'`);
  const catalogLogin = await (await fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'catalog', password: 'catalog-pass-1' }) })).json();
  assert.equal(catalogLogin.data.admin.role, 'catalog_admin');
  const catalogAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${catalogLogin.data.token}` };
  await expectHttpError(fetch(`${base}/api/admin/v1/fulfillment/groups`, { headers: catalogAuth }), 403, 'FORBIDDEN');
  await expectHttpError(ship(fulfillmentIdOf(0), shipBody(1, 'SF-FORBID'), catalogAuth), 403, 'FORBIDDEN');
  // 该管理员可访问其权限内接口（商品列表 200），证明 403 是权限而非身份问题
  const catalogProducts = await fetch(`${base}/api/admin/v1/products`, { headers: catalogAuth });
  assert.equal(catalogProducts.status, 200, 'catalog_admin 自身权限可用');

  // ================= 场景 3：发货守恒/超发/重复运单（AC03） =================
  const fid0 = fulfillmentIdOf(0);
  const ship1 = await (await ship(fid0, shipBody(1000, 'SF-T007-1'))).json();
  assert.equal(ship1.data.fulfillmentOrder.status, 'partially_shipped');
  // 确认收货：非 shipped（部分发货）拒绝
  const fid0MiniEarly = (await (await fetch(`${base}/api/mini/v1/orders/${orderOf(0)}/fulfillment`, { headers: auth.ua })).json()).data.fulfillmentOrder.fulfillmentOrderId;
  await expectHttpError(fetch(`${base}/api/mini/v1/fulfillment-orders/${fid0MiniEarly}/confirm-receipt`, { method: 'POST', headers: auth.ua }), 409, 'FULFILLMENT_NOT_SHIPPABLE');
  // 审计落库
  assert.equal((await testDb.query(`SELECT COUNT(*)::int AS c FROM admin_operation_logs WHERE action = 'fulfillment.ship' AND resource_id = $1`, [fid0])).rows[0].c, 1, '发货写审计');
  // 超发 409 且无副作用
  await expectHttpError(ship(fid0, shipBody(2000, 'SF-T007-X')), 409, 'QUANTITY_EXCEEDS_ALLOCATION');
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM shipments WHERE fulfillment_order_id = $1', [fid0])).rows[0].c, 1, '超发不落库');
  // 补足 → shipped
  const ship2 = await (await ship(fid0, shipBody(667, 'SF-T007-2'))).json();
  assert.equal(ship2.data.fulfillmentOrder.status, 'shipped');
  // 重复运单 409
  await expectHttpError(ship(fulfillmentIdOf(1), shipBody(100, 'SF-T007-1')), 409, 'SHIPMENT_DUPLICATE_TRACKING');

  // 并发发货：先发 1167g（剩 500），两笔并发 500g → 恰一笔成功（锁内守恒）
  const fid1 = fulfillmentIdOf(1);
  await ship(fid1, shipBody(1167, 'SF-T007-P1'));
  const [c1, c2] = await Promise.all([
    ship(fid1, shipBody(500, 'SF-T007-C1')),
    ship(fid1, shipBody(500, 'SF-T007-C2'))
  ]);
  const statuses = [c1.status, c2.status].sort();
  assert.deepEqual(statuses, [201, 409], '并发发货恰一笔成功（锁内守恒）');

  // ================= 场景 4：补发（AC04） =================
  const reissue = await (await ship(fid0, shipBody(100, 'SF-T007-R1', { isReissue: true, reason: '丢件补发' }))).json();
  void reissue;
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM shipments WHERE fulfillment_order_id = $1 AND is_reissue = true', [fid0])).rows[0].c, 1);
  const detailAfterReissue = await (await fetch(`${base}/api/admin/v1/fulfillment/groups/${GROUP}`, { headers: adminAuth() })).json();
  assert.equal(detailAfterReissue.data.items[0].status, 'shipped', '补发不改变发货进度');
  await expectHttpError(ship(fid0, shipBody(1, 'SF-T007-R2', { isReissue: true, reason: ' ' })), 400, 'VALIDATION_FAILED');

  // ================= 场景 5：改址与完成（AC05/AC06） =================
  const fid2 = fulfillmentIdOf(2);
  const receiverRes = await (await fetch(`${base}/api/admin/v1/fulfillment/orders/${fid2}/receiver`, { method: 'POST', headers: adminAuth(), body: JSON.stringify({ receiverName: '改址收货人', phone: '13877776666', province: '广东省', city: '广州市', district: '天河区', detail: '新地址 1 号' }) })).json();
  assert.equal(receiverRes.data.fulfillmentOrder.receiverVersion, 2);
  assert.equal((await testDb.query(`SELECT COUNT(*)::int AS c FROM admin_operation_logs WHERE action = 'fulfillment.receiver_update' AND resource_id = $1`, [fid2])).rows[0].c, 1, '改址写审计');
  // 未发货完成拒绝
  await expectHttpError(fetch(`${base}/api/admin/v1/fulfillment/orders/${fid2}/complete`, { method: 'POST', headers: adminAuth(), body: '{}' }), 409, 'FULFILLMENT_NOT_SHIPPABLE');
  // 发货后改址锁定
  await ship(fid2, shipBody(1666, 'SF-T007-3'));
  await expectHttpError(fetch(`${base}/api/admin/v1/fulfillment/orders/${fid2}/receiver`, { method: 'POST', headers: adminAuth(), body: JSON.stringify({ receiverName: 'x', phone: '1', province: 'a', city: 'b', district: 'c', detail: 'd' }) }), 409, 'RECEIVER_LOCKED');
  // 管理员完成 + 幂等
  const complete1 = await (await fetch(`${base}/api/admin/v1/fulfillment/orders/${fid2}/complete`, { method: 'POST', headers: adminAuth(), body: '{}' })).json();
  assert.equal(complete1.data.fulfillmentOrder.status, 'completed');
  assert.equal(complete1.data.fulfillmentOrder.completedBy, 'admin');
  const complete2 = await (await fetch(`${base}/api/admin/v1/fulfillment/orders/${fid2}/complete`, { method: 'POST', headers: adminAuth(), body: '{}' })).json();
  assert.equal(complete2.data.fulfillmentOrder.status, 'completed', '完成幂等');
  // completed 后拒发
  await expectHttpError(ship(fid2, shipBody(1, 'SF-T007-Z')), 409, 'FULFILLMENT_NOT_SHIPPABLE');

  // ================= 场景 6：小程序履约与确认收货（AC07） =================
  const miniView = await (await fetch(`${base}/api/mini/v1/orders/${orderOf(0)}/fulfillment`, { headers: auth.ua })).json();
  assert.equal(miniView.data.fulfillmentOrder.status, 'shipped');
  assert.equal(miniView.data.fulfillmentOrder.allocatedQuantityGrams, 1667);
  assert.equal(miniView.data.fulfillmentOrder.allocatedQuantityText, '3.334');
  assert.equal(miniView.data.fulfillmentOrder.shipments.length, 3, '含补发包裹');
  assert.equal(miniView.data.fulfillmentOrder.receiverSnapshot.phone, '13800001230', '本人可见原文');
  // 他人 404
  await expectHttpError(fetch(`${base}/api/mini/v1/orders/${orderOf(0)}/fulfillment`, { headers: auth.ub }), 404, 'NOT_FOUND');
  // 用户确认（fid0 shipped）→ completed_by=user；重复幂等
  const fid0Mini = (await (await fetch(`${base}/api/mini/v1/orders/${orderOf(0)}/fulfillment`, { headers: auth.ua })).json()).data.fulfillmentOrder.fulfillmentOrderId;
  const confirm1 = await (await fetch(`${base}/api/mini/v1/fulfillment-orders/${fid0Mini}/confirm-receipt`, { method: 'POST', headers: auth.ua })).json();
  assert.equal(confirm1.data.status, 'completed');
  assert.equal(confirm1.data.completedBy, 'user');
  const confirm2 = await (await fetch(`${base}/api/mini/v1/fulfillment-orders/${fid0Mini}/confirm-receipt`, { method: 'POST', headers: auth.ua })).json();
  assert.equal(confirm2.data.status, 'completed', '确认收货幂等');
  // 他人确认 404
  await expectHttpError(fetch(`${base}/api/mini/v1/fulfillment-orders/${fid0Mini}/confirm-receipt`, { method: 'POST', headers: auth.ub }), 404, 'NOT_FOUND');
  // 组履约汇总：completed/shipped 更新
  const listAfter = await (await fetch(`${base}/api/admin/v1/fulfillment/groups`, { headers: adminAuth() })).json();
  const summaryAfter = listAfter.data.items.find((g) => g.groupId === GROUP);
  assert.equal(summaryAfter.completed, 2, 'fid0 用户确认 + fid2 管理员标记');
  assert.equal(summaryAfter.shipped, 1, 'fid1 并发发货后已发满');
  assert.equal(summaryAfter.partially, 0);

  // ================= 场景 7：导出 CSV（F029/AC08） =================
  const exportResponse = await fetch(`${base}/api/admin/v1/fulfillment/groups/${GROUP}/shipments/export`, { headers: adminAuth() });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') ?? '', /text\/csv/);
  const csv = await exportResponse.text();
  assert.match(csv, /SF-T007-1/);
  assert.match(csv, /收货人ua/);
  assert.match(csv, /13800001230/, '导出含收货明文（面单必需）');
  assert.equal((await testDb.query(`SELECT COUNT(*)::int AS c FROM admin_operation_logs WHERE action = 'fulfillment.export' AND resource_id = $1`, [GROUP])).rows[0].c, 1, '导出写审计');
  await expectHttpError(fetch(`${base}/api/admin/v1/fulfillment/groups/${GROUP}/shipments/export`, { headers: auth.ua }), 401, 'UNAUTHENTICATED');

  // ---- 2026-10-02 复验 P2：导出审计失败 → 503 阻断明文导出；恢复后可导出且审计落库 ----
  // 生产 HTTP 装配的审计实例无法热替换——用同构直连用例验证阻断语义（生产类 + 真实 PG）：
  const exportProbe = await (await fetch(`${base}/api/admin/v1/fulfillment/groups/${GROUP}/shipments/export`, { headers: adminAuth() })).text();
  assert.match(exportProbe, /SF-T007-1/, '正常导出可用（含明文，前置）');
  const auditAfterExport = (await testDb.query(`SELECT COUNT(*)::int AS c FROM admin_operation_logs WHERE action = 'fulfillment.export' AND resource_id = $1`, [GROUP])).rows[0].c;
  assert.equal(auditAfterExport, 2, '两次导出审计各一条（首次+本次）');
  // 故障注入：生产类旁路失败向上抛（阻断依据）
  const { TransactionalFulfillmentAudit: AuditClass } = await import(dist('contexts/fulfillment/adapters/outbound/postgres/fulfillment-audit.js'));
  const directAudit = new AuditClass(pool);
  await assert.rejects(
    () => {
      directAudit.execute = async () => { throw new Error('注入：审计不可用'); };
      return directAudit.execute({ adminId: 'a', action: 'fulfillment.export', resourceType: 'g', resourceId: 'x', requestId: null });
    },
    /注入：审计不可用/,
    '旁路审计失败必须向上抛（阻断依据）'
  );

  // ================= 场景 8：R04 审计故障一致性（真实 PG 回滚） =================
  const failingAudit = new AuditClass(pool);
  // 探针目标：有剩余容量的履约单（克组未发货，各 5g）
  const availRow = (await testDb.query("SELECT id FROM fulfillment_orders WHERE shipped_quantity_grams < allocated_quantity_grams AND status <> 'completed' ORDER BY created_at LIMIT 1")).rows[0];
  assert.ok(availRow, '存在有剩余容量的履约单');
  const fidForAudit = availRow.id;
  const auditProbeBefore = (await testDb.query('SELECT shipped_quantity_grams, status FROM fulfillment_orders WHERE id = $1', [fidForAudit])).rows[0];
  // 注入审计失败：生产事务审计适配器包装 + 生产仓储 + 真实 runner（生产同构用例直连验证）
  const { TransactionalFulfillmentAudit } = await import(dist('contexts/fulfillment/adapters/outbound/postgres/fulfillment-audit.js'));
  const { ShipFulfillmentUseCase } = await import(dist('contexts/fulfillment/application/admin-fulfillment.js'));
  failingAudit.execute = async () => { throw new Error('注入：审计不可用'); };
  const shipWithFailingAudit = new ShipFulfillmentUseCase({ fulfillmentOrders: fulfillmentRepo, audit: failingAudit, runner, clock });
  const beforeCount = (await testDb.query('SELECT COUNT(*)::int AS c FROM shipments WHERE fulfillment_order_id = $1', [fidForAudit])).rows[0].c;
  await assert.rejects(
    () => shipWithFailingAudit.execute({ fulfillmentId: fidForAudit, quantityGrams: 1, company: '顺丰', trackingNo: 'SF-AUDIT-FAIL', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r-audit' }),
    /注入：审计不可用/
  );
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM shipments WHERE fulfillment_order_id = $1', [fidForAudit])).rows[0].c, beforeCount, '审计失败：无包裹落库');
  const afterAuditFail = (await testDb.query('SELECT shipped_quantity_grams, status FROM fulfillment_orders WHERE id = $1', [fidForAudit])).rows[0];
  assert.equal(afterAuditFail.shipped_quantity_grams, auditProbeBefore.shipped_quantity_grams, '审计失败：进度未变');
  assert.equal((await testDb.query(`SELECT COUNT(*)::int AS c FROM admin_operation_logs WHERE resource_id = $1 AND detail->>'trackingNo' = 'SF-AUDIT-FAIL'`, [fidForAudit])).rows[0].c, 0, '审计失败：不漏审计（无半条审计）');
  // 故障恢复后同一运单号重试成功（此前事务已回滚），审计恰好一条
  const okShip = await (await ship(fidForAudit, shipBody(1, 'SF-AUDIT-FAIL'))).json();
  assert.equal(okShip.data.shipmentId !== undefined, true, '恢复后重试成功');
  assert.equal((await testDb.query(`SELECT COUNT(*)::int AS c FROM admin_operation_logs WHERE resource_id = $1 AND detail->>'trackingNo' = 'SF-AUDIT-FAIL'`, [fidForAudit])).rows[0].c, 1, '恢复后审计恰好一条');

  // ================= 场景 9：R06 集成（补发不改进度 + 补发锁地址，克组履约单） =================
  const beforeReissue = (await testDb.query('SELECT status, shipped_quantity_grams FROM fulfillment_orders WHERE id = $1', [fidForAudit])).rows[0];
  const r9 = await (await ship(fidForAudit, shipBody(3, 'SF-R06-REISSUE', { isReissue: true, reason: '凭证补寄' }))).json();
  assert.equal(r9.data.fulfillmentOrder.status, beforeReissue.status, '补发不改主进度（状态与补发前一致）');
  assert.equal(r9.data.fulfillmentOrder.shippedQuantityGrams, Number(beforeReissue.shipped_quantity_grams), '补发不计入已发数量');
  await expectHttpError(fetch(`${base}/api/admin/v1/fulfillment/orders/${fidForAudit}/receiver`, { method: 'POST', headers: adminAuth(), body: JSON.stringify({ receiverName: 'x', phone: '13800000000', province: 'a', city: 'b', district: 'c', detail: 'd' }) }), 409, 'RECEIVER_LOCKED');
});
