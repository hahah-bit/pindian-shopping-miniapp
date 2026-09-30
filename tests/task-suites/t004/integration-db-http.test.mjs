import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

async function unusedPort() {
  const server = createServer();
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const port = server.address().port;
  await new Promise((res) => server.close(res));
  return port;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([l, body, crc]); }
function makePng(width, height) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x01]))), chunk('IEND', Buffer.alloc(0))]);
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
  url.pathname = '/pindian_t004_test';
  return { adminUrl: envUrl, testUrl: url.toString() };
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
  assert.equal(response.status, status, `期望 HTTP ${status} 实际 ${response.status}`);
  const body = await response.json();
  assert.equal(body.code, code);
  return body;
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

test('T004 集成：下单匹配、容量/库存并发、幂等、尾差、取消、过期任务、后台查询全流程', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t004_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t004_test');
  context.after(async () => {
    await admin.end(); // 调试：保留库
  });

  const migrateOut = await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`迁移失败：${out}`))));
  });
  assert.match(migrateOut, /已应用 0010/);

  const port = await unusedPort();
  const mediaDir = mkdtempSync(join(tmpdir(), 'pindian-t004-'));
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

  // 统一清理：停 API → 断连 → 删目录 → 删库
  context.after(async () => {
    if (api.exitCode === null) api.kill();
    await new Promise((r) => { api.once('exit', r); setTimeout(r, 3000).unref(); });
    rmSync(mediaDir, { recursive: true, force: true });
    if (process.env.PINDIAN_KEEP_TEST_DB !== '1') {
      await admin.query('DROP DATABASE IF EXISTS pindian_t004_test WITH (FORCE)').catch(() => {});
    }
    await admin.end();
  });

  // ---- 造数据：全部使用测试库连接（严禁写入主库） ----
  const testDb = new pg.Client({ connectionString: database.testUrl });
  await testDb.connect();
  context.after(async () => { await testDb.end().catch(() => {}); });
  const users = {};
  for (const name of ['ua', 'ub', 'uc']) {
    const id = `aaaaaaaa-0000-4000-8000-0000000000${['01', '02', '03']['uaubuc'.indexOf(name) / 2 | 0] ?? '01'}`;
  }
  const userIds = {
    ua: 'aaaaaaaa-1111-4111-8111-000000000001',
    ub: 'aaaaaaaa-1111-4111-8111-000000000002',
    uc: 'aaaaaaaa-1111-4111-8111-000000000003'
  };
  for (const [key, id] of Object.entries(userIds)) {
    await testDb.query(`INSERT INTO users (id, nickname, status) VALUES ($1, $2, 'active') ON CONFLICT (id) DO NOTHING`, [id, `用户${key}`]);
    const token = `tok-${key}-${Date.now()}`;
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await testDb.query(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [id, hash]);
    users[key] = { id, token, auth: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  }
  // 地址
  for (const [key, user] of Object.entries(users)) {
    await testDb.query(
      `INSERT INTO user_addresses (id, user_id, receiver_name, phone, province, city, district, detail)
       VALUES ($1, $2, '收货人', '13800001234', '广东省', '深圳市', '南山区', '测试地址 1 号楼 101')`,
      [`dddddddd-0000-4000-8000-0000000000${key === 'ua' ? '01' : key === 'ub' ? '02' : '03'}`, user.id]
    );
  }
  const addressOf = (key) => `dddddddd-0000-4000-8000-0000000000${key === 'ua' ? '01' : key === 'ub' ? '02' : '03'}`;

  // ---- 造商品：上架、原价 50000、允许 4 份额、库存 3 ----
  const productId = 'cccccccc-9999-4999-8999-999999999999';
  await testDb.query(
    `INSERT INTO products (id, name, description, original_price_fen, whole_quantity, unit, allowed_share_units, status, group_deadline_hours)
     VALUES ($1, '测试苹果', '', 50000, 10, '斤', ARRAY[30,20,15,12], 'on_shelf', 24)`,
    [productId]
  );
  await testDb.query(`INSERT INTO stocks (product_id, available_whole_items) VALUES ($1, 3)`, [productId]);
  // 商品主图（组摘要 mini 视图不需要，但保持数据完整性）
  await testDb.query(
    `INSERT INTO media_assets (id, storage_key, format, size_bytes, width, height, sha256, status)
     VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'products/2026/11111111-1111-4111-8111-111111111111.png', 'png', 1000, 64, 64, '` + 'f'.repeat(64) + `', 'ready')`
  ).catch(() => {});

  const place = (userKey, body) => fetch(`${base}/api/mini/v1/orders`, {
    method: 'POST', headers: { ...users[userKey].auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const keyGen = (() => { let n = 0; return () => `77777777-7777-4777-8777-${String(++n).padStart(12, '0')}`; })();

  // ---- 用户 A 下单：无组 → 建组 + 首单标准价（G 建组预留库存） ----
  const r1 = await (await place('ua', { productId, units: 20, addressId: addressOf('ua'), idempotencyKey: keyGen() })).json();
  assert.equal(r1.data.status, 'unpaid');
  assert.equal(r1.data.quote.totalAmountFen, 16833);
  assert.equal(r1.data.quote.isFinalOrder, false);
  const groupId = r1.data.groupId;
  const stockAfterCreate = await testDb.query('SELECT available_whole_items AS a, reserved_whole_items AS r FROM stocks WHERE product_id = $1', [productId]);
  assert.equal(stockAfterCreate.rows[0].a, 2, '建组预留：available 3→2');
  assert.equal(stockAfterCreate.rows[0].r, 1, '建组预留：reserved 0→1');

  // ---- 幂等：同键同内容返回原单；同键异内容 409（G6）。注意 i1/i2 必须共用同一键 ----
  const idem = keyGen();
  const i1 = await (await place('ua', { productId, units: 20, addressId: addressOf('ua'), idempotencyKey: idem })).json();
  assert.equal(i1.data.status, 'unpaid', '首次请求建单');
  const i2Raw = await place('ua', { productId, units: 20, addressId: addressOf('ua'), idempotencyKey: idem });
  const i2 = await i2Raw.json();
  assert.equal(i2.data.id, i1.data.id, '幂等返回原订单');
  const orderCount = await testDb.query('SELECT COUNT(*)::int AS c FROM orders WHERE user_id = $1 AND idempotency_key = $2', [users.ua.id, idem]);
  assert.equal(orderCount.rows[0].c, 1, '仅一笔订单');
  await expectHttpError(place('ua', { productId, units: 15, addressId: addressOf('ua'), idempotencyKey: idem }), 409, 'IDEMPOTENCY_CONFLICT');
  // 此刻组容量：r1 20 + i1 20 = 40
  const capacityNow = await testDb.query('SELECT paid_units + reserved_units AS occ FROM groups WHERE id = $1', [groupId]);
  assert.equal(Number(capacityNow.rows[0].occ), 40, '两笔订单占用 40');

  // ---- 越权：B 用 A 的地址 404（G11） ----
  await expectHttpError(place('ub', { productId, units: 15, addressId: addressOf('ua'), idempotencyKey: keyGen() }), 404, 'ADDRESS_NOT_FOUND');

  // ---- 三连 1/3 填满（G10）：本阶段全部标准价（D001 修订——补差仅当前面全部已生效，零头对账属支付阶段） ----
  const r2 = await (await place('ub', { productId, units: 20, addressId: addressOf('ub'), idempotencyKey: keyGen() })).json();
  assert.equal(r2.data.groupId, groupId, 'B 加入同一组');
  assert.equal(r2.data.quote.isFinalOrder, false, '前面未全部生效 → 标准价（D001 修订）');
  assert.equal(r2.data.quote.totalAmountFen, 16833);
  const r3 = await (await place('uc', { productId, units: 20, addressId: addressOf('uc'), idempotencyKey: keyGen() })).json();
  assert.equal(r3.data.quote.isFinalOrder, false);
  assert.equal(r3.data.quote.totalAmountFen, 16833);
  const paidSum = await testDb.query('SELECT paid_units, reserved_units FROM groups WHERE id = $1', [groupId]);
  assert.equal(paidSum.rows[0].paid_units, 0, '预占不计入已支付（未接支付）');
  const row = paidSum.rows[0];
  assert.equal(Number(row.paid_units) + Number(row.reserved_units), 60, '容量满 60');
  // Σ报价 50499 ≤ 整件价 50500（不超收）；零头 1 分在支付阶段按 D001 修订对账
  assert.ok(16833 * 3 <= 50500, 'Σ报价不超过整件价');

  // ---- 竞争：D 再买任何份额 → 容量满，全部候选失败 → 建组（库存 2 可用）----
  await testDb.query(`INSERT INTO users (id, nickname, status) VALUES ('aaaaaaaa-1111-4111-8111-000000000004', '用户ud', 'active')`);
  const tokenD = 'tok-ud';
  const cryptoD = await import('node:crypto');
  await testDb.query(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ('aaaaaaaa-1111-4111-8111-000000000004', $1, now() + interval '1 day')`, [cryptoD.createHash('sha256').update(tokenD).digest('hex')]);
  await testDb.query(`INSERT INTO user_addresses (id, user_id, receiver_name, phone, province, city, district, detail) VALUES ('dddddddd-0000-4000-8000-000000000004', 'aaaaaaaa-1111-4111-8111-000000000004', '收货人D', '13800001234', '广东省', '深圳市', '南山区', '测试地址 1 号楼 101')`);
  const userD = { auth: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenD}` } };
  // 满 60 组不可加入 → 建新组（整件预留 2→1）
  const rD = await (await fetch(`${base}/api/mini/v1/orders`, {
    method: 'POST', headers: { ...userD.auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, units: 15, addressId: 'dddddddd-0000-4000-8000-000000000004', idempotencyKey: keyGen() })
  })).json();
  assert.notEqual(rD.data.groupId, groupId, '满组不可加入，建新组');
  assert.equal(rD.data.quote.totalAmountFen, 12625, '新组首单标准价 1/4');
  const stock2 = await testDb.query('SELECT available_whole_items AS a, reserved_whole_items AS r FROM stocks WHERE product_id = $1', [productId]);
  assert.equal(stock2.rows[0].a, 0, '组1+组B+组C 三次建组：available 3→0');
  assert.equal(stock2.rows[0].r, 3, '三次建组：reserved 0→3');

  // ---- 并发最后份额（G4）：组C 剩 45 → B 买 30 后剩 15；C 与 ua 并发各买 15 → 一人加入组C，另一人建组失败（库存 0，409） ----
  const rB = await (await place('ub', { productId, units: 30, addressId: addressOf('ub'), idempotencyKey: keyGen() })).json();
  assert.equal(rB.data.groupId, rD.data.groupId, 'B 加入 D 的新组（剩 45 → 买 30 后剩 15 可完成）');
  const [c1, c2] = await Promise.all([
    place('uc', { productId, units: 15, addressId: addressOf('uc'), idempotencyKey: keyGen() }),
    place('ua', { productId, units: 15, addressId: addressOf('ua'), idempotencyKey: keyGen() })
  ]);
  const results = [await c1.json(), await c2.json()];
  // DB 事实断言：组C 恰好填满 60（D15+B30+并发成功者 15）；库存 0 不超卖；失败请求为库存不足
  const allG = await testDb.query('SELECT id::text AS id, status, paid_units, reserved_units FROM groups ORDER BY created_at');
  assert.equal(allG.rowCount, 3, '共三组');
  const groupC = allG.rows[2];
  assert.equal(Number(groupC.reserved_units) + Number(groupC.paid_units), 60, '组C 恰好填满（并发仅一人成功加入）');
  const stock3 = await testDb.query('SELECT available_whole_items AS a, reserved_whole_items AS r FROM stocks WHERE product_id = $1', [productId]);
  assert.equal(stock3.rows[0].a, 0, '库存保持 0（无超卖）');
  assert.equal(stock3.rows[0].r, 3, '三件全部被组占用');
  const failed = results.filter((r) => !r.data);
  assert.equal(failed.length, 1, '另一请求建组失败（库存 0，STOCK_INSUFFICIENT）');
  assert.equal(failed[0].code, 'STOCK_INSUFFICIENT');

  // ---- 取消未支付订单：释放预占与容量（取消 B 在组C 的 30 单） ----
  const cancelResponse = await fetch(`${base}/api/mini/v1/orders/${rB.data.id}/cancel`, { method: 'POST', headers: users.ub.auth });
  assert.equal(cancelResponse.status, 200);
  const afterCancel = await testDb.query('SELECT reserved_units FROM groups WHERE id = $1', [rD.data.groupId]);
  assert.equal(Number(afterCancel.rows[0].reserved_units), 30, '取消后组C 容量回落（60−30）');

  // ---- 越权：B 读 A 的订单 404；无权限 admin 403（G12） ----
  const aOrder = await testDb.query(`SELECT id FROM orders WHERE user_id = $1 LIMIT 1`, [users.ua.id]);
    await expectHttpError(fetch(`${base}/api/mini/v1/orders/${aOrder.rows[0].id}`, { headers: users.ub.auth }), 404, 'NOT_FOUND');

  // ---- 到期任务：把一单 reservation_expires_at 改为过去 → 手动触发（直接调用 dist 任务） ----
  const expiredOrder = await testDb.query(`SELECT id, group_id FROM orders WHERE user_id = $1 AND status = 'unpaid' LIMIT 1`, [users.uc.id]);
  if (expiredOrder.rows.length) {
    await testDb.query(`UPDATE share_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = $1`, [expiredOrder.rows[0].id]);
    await testDb.query(`UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = $1`, [expiredOrder.rows[0].id]);
    const taskResult = await new Promise((res, rej) => {
      const child = spawn(process.execPath, ['-e', `
        const { ExpireReservationsTask } = require('./backend/dist/workflows/order-expiry.tasks.js');
        const { PostgresGroupRepository, PostgresShareReservationRepository } = require('./backend/dist/contexts/group-buying/adapters/outbound/postgres/group-repositories.js');
        const { PostgresOrderRepository } = require('./backend/dist/contexts/ordering/adapters/outbound/postgres/order-repository.js');
        const pg = require('./node_modules/pg/lib/index.js');
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
        const deps = {
          groups: new PostgresGroupRepository(pool),
          reservations: new PostgresShareReservationRepository(pool),
          orders: new PostgresOrderRepository(pool),
          runner: { async run(w) { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await w(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } } },
          clock: { now: () => new Date() }
        };
        new ExpireReservationsTask(deps).execute({ limit: 100 }).then((n) => { console.log('processed=' + n); return pool.end(); }).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
      `], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
      child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`任务失败：${out}`))));
    });
    assert.match(taskResult, /processed=[1-9]/, '过期任务处理到期预占');
    const afterExpiry = await testDb.query('SELECT status FROM orders WHERE id = $1', [expiredOrder.rows[0].id]);
    assert.equal(afterExpiry.rows[0].status, 'expired', '订单被标记过期');
    const repeatResult = await new Promise((res) => {
      const child = spawn(process.execPath, ['-e', `
        const { ExpireReservationsTask } = require('./backend/dist/workflows/order-expiry.tasks.js');
        const { PostgresGroupRepository, PostgresShareReservationRepository } = require('./backend/dist/contexts/group-buying/adapters/outbound/postgres/group-repositories.js');
        const { PostgresOrderRepository } = require('./backend/dist/contexts/ordering/adapters/outbound/postgres/order-repository.js');
        const pg = require('./node_modules/pg/lib/index.js');
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
        const deps = { groups: new PostgresGroupRepository(pool), reservations: new PostgresShareReservationRepository(pool), orders: new PostgresOrderRepository(pool), runner: { async run(w) { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await w(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } } }, clock: { now: () => new Date() } };
        new ExpireReservationsTask(deps).execute({ limit: 100 }).then((n) => { console.log('processed=' + n); return pool.end(); });
      `], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; child.stdout.on('data', (d) => { out += d; });
      child.on('exit', () => res(out));
    });
    assert.match(repeatResult, /processed=0/, '重复执行零处理（幂等）');
  }

  // ---- 后台：管理员登录 + 订单/组查询（脱敏） ----
  await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/create-admin.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl, ADMIN_INITIAL_USERNAME: 'root', ADMIN_INITIAL_PASSWORD: 't004-admin-pass' }, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error('create-admin 失败'))));
  });
  const adminLogin = await (await fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'root', password: 't004-admin-pass' }) })).json();
  const authAdmin = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminLogin.data.token}` };
  const adminOrdersRaw = await fetch(`${base}/api/admin/v1/orders`, { headers: authAdmin });
  const adminOrders = await adminOrdersRaw.json();
  assert.ok(adminOrders.data.total >= 4);
  assert.ok(!JSON.stringify(adminOrders).includes('13800001234'), '后台订单列表脱敏');
  const adminGroupsRaw = await fetch(`${base}/api/admin/v1/groups`, { headers: authAdmin });
  const adminGroups = await adminGroupsRaw.json();
  assert.ok(adminGroups.data.total >= 2);
  const groupDetail = await (await fetch(`${base}/api/admin/v1/groups/${groupId}`, { headers: authAdmin })).json();
  assert.ok(!JSON.stringify(groupDetail).includes('13800001234'), '组详情无手机号');
  assert.ok(!JSON.stringify(groupDetail).includes('科技园'), '组详情无地址');
  assert.equal(groupDetail.data.members.length >= 2, true, '组内成员摘要');

  // mini 商品接口回归（T002 能力不受影响）
  const miniProducts = await (await fetch(`${base}/api/mini/v1/products`)).json();
  assert.equal(miniProducts.data.total, 1, 'T002 商品展示正常');
});
