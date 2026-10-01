import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createCipheriv, createSign, randomBytes, createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  url.pathname = '/pindian_t006_test';
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

// ---- APIv3 AES-256-GCM 加密（tag 后置 16 字节）——与官方回调 resource 结构一致 ----
function makeCiphertext(plain, nonce, apiV3Key, aad = 'transaction') {
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiV3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]);
  return Buffer.concat([data, cipher.getAuthTag()]).toString('base64');
}

function rsaSign(privateKey, message) {
  return createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

test('T006 集成：强制验签回调、刷新查单、组截止退款、迟到支付退款、取消退款事务、让利台账、金额库存一致（真实 PG+HTTP+本地渠道假件）', { timeout: 300_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t006_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t006_test');
  context.after(async () => {
    await admin.end(); // 调试：保留库
  });

  const migrateOut = await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(`迁移失败：${out}`))));
  });
  assert.match(migrateOut, /已应用 0015/);

  // ---- 商户密钥（临时目录，不入 Git）与本地假微信渠道 ----
  const MCHID = '1900000042';
  const APPID = 'wx-t006-appid';
  const APIV3 = 't006-api-v3-key-32bytes-abcdefgh';
  const SERIAL = 'T006SERIAL0001';
  const keyDir = mkdtempSync(join(tmpdir(), 'pindian-t006-keys-'));
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const merchantKeyPath = join(keyDir, 'apiclient_key.pem');
  writeFileSync(merchantKeyPath, merchant.privateKey.export({ type: 'pkcs1', format: 'pem' }));
  // 平台密钥对（微信支付公钥模式）：公钥给 API 验签，私钥在测试里签回调
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platformPubPath = join(keyDir, 'platform_pub.pem');
  writeFileSync(platformPubPath, platform.publicKey.export({ type: 'spki', format: 'pem' }));
  context.after(() => { rmSync(keyDir, { recursive: true, force: true }); });

  // 假渠道：下单/查单/关单/退款提交/退款查询；退款提交可切换为失败（模拟渠道异常）
  let refundSubmitMode = 'ok'; // ok | fail
  let refundQueryState = 'PROCESSING';
  const orderTotals = new Map(); // out_trade_no → amount.total（jsapi 下单时记录，供查单返回）
  const wxRequests = [];
  const fakeWx = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      wxRequests.push({ method: req.method, url: req.url, body });
      const reply = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.method === 'POST' && req.url === '/v3/pay/transactions/jsapi') {
        try { const sent = JSON.parse(body); orderTotals.set(sent.out_trade_no, sent.amount?.total ?? 0); } catch {}
        return reply(200, { prepay_id: `prep-${wxRequests.length}` });
      }
      if (req.method === 'GET' && req.url.startsWith('/v3/pay/transactions/out-trade-no/')) {
        const no = decodeURIComponent(req.url.split('/v3/pay/transactions/out-trade-no/')[1].split('?')[0]);
        return reply(200, { trade_state: 'SUCCESS', transaction_id: `wx-q-${no.slice(-6)}`, amount: { payer_total: orderTotals.get(no) ?? 0 } });
      }
      if (req.method === 'POST' && req.url === '/v3/refund/domestic/refunds') {
        if (refundSubmitMode === 'fail') return reply(500, { code: 'SYSTEM_ERROR', message: '渠道系统异常' });
        return reply(200, { status: 'PROCESSING', refund_id: `wxr-${wxRequests.length}` });
      }
      if (req.method === 'GET' && req.url.startsWith('/v3/refund/domestic/refunds/')) return reply(200, { status: refundQueryState, refund_id: 'wxr-q' });
      return reply(404, { code: 'NOT_FOUND', message: `未模拟 ${req.method} ${req.url}` });
    });
  });
  const wxPort = await new Promise((res) => fakeWx.listen(0, '127.0.0.1', () => res(fakeWx.address().port)));
  context.after(async () => { await new Promise((r) => fakeWx.close(r)); });

  // ---- 启动真实 API（生产装配 + HttpWxPayAdapter 指向本地假渠道 + 平台公钥强制验签） ----
  const port = await unusedPort();
  const mediaDir = mkdtempSync(join(tmpdir(), 'pindian-t006-'));
  const logs = { text: '' };
  const api = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: database.testUrl,
      MEDIA_DIR: mediaDir,
      PUBLIC_API_BASE_URL: `http://127.0.0.1:${port}`,
      WX_APPID: APPID,
      WX_PAY_MCHID: MCHID,
      WX_PAY_APIV3_KEY: APIV3,
      WX_PAY_SERIAL_NO: SERIAL,
      WX_PAY_PRIVATE_KEY_PATH: merchantKeyPath,
      WX_PAY_PLATFORM_PUBLIC_KEY_PATH: platformPubPath,
      WX_PAY_NOTIFY_URL: `http://127.0.0.1:${port}/api/payments/v1/notify`,
      WX_PAY_ENDPOINT_BASE: `http://127.0.0.1:${wxPort}`
    },
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
      await admin.query('DROP DATABASE IF EXISTS pindian_t006_test WITH (FORCE)').catch(() => {});
    }
  });

  // ---- 造数据：全部使用测试库连接（严禁写入主库） ----
  const testDb = new pg.Client({ connectionString: database.testUrl });
  await testDb.connect();
  context.after(async () => { await testDb.end().catch(() => {}); });
  const userIds = {
    ua: 'aaaaaaaa-2222-4222-8222-000000000001',
    ub: 'aaaaaaaa-2222-4222-8222-000000000002',
    uc: 'aaaaaaaa-2222-4222-8222-000000000003',
    ud: 'aaaaaaaa-2222-4222-8222-000000000004',
    ue: 'aaaaaaaa-2222-4222-8222-000000000005',
    uf: 'aaaaaaaa-2222-4222-8222-000000000006',
    ug: 'aaaaaaaa-2222-4222-8222-000000000007'
  };
  const users = {};
  for (const [key, id] of Object.entries(userIds)) {
    await testDb.query(`INSERT INTO users (id, nickname, status) VALUES ($1, $2, 'active') ON CONFLICT (id) DO NOTHING`, [id, `用户${key}`]);
    await testDb.query(
      `INSERT INTO user_wechat_identities (id, openid, user_id, bound_at) VALUES ($1, $2, $3, now())`,
      [`bbbbbbbb-0000-4000-8000-0000000000${String(Object.keys(userIds).indexOf(key) + 1).padStart(2, '0')}`, `openid-${key}`, id]
    );
    const token = `tok-${key}-${Date.now()}`;
    await testDb.query(`INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [id, createHash('sha256').update(token).digest('hex')]);
    const addressId = `dddddddd-1000-4000-8000-0000000000${String(Object.keys(userIds).indexOf(key) + 1).padStart(2, '0')}`;
    await testDb.query(
      `INSERT INTO user_addresses (id, user_id, receiver_name, phone, province, city, district, detail)
       VALUES ($1, $2, '收货人', '13800001234', '广东省', '深圳市', '南山区', '测试地址 1 号楼 101')`,
      [addressId, id]
    );
    users[key] = { id, token, addressId, auth: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };
  }
  const productId = 'cccccccc-6666-4666-8666-666666666666';
  await testDb.query(
    `INSERT INTO products (id, name, description, original_price_fen, whole_quantity, unit, allowed_share_units, status, group_deadline_hours)
     VALUES ($1, '测试苹果', '', 50000, 10, '斤', ARRAY[30,20,15,12], 'on_shelf', 24)`,
    [productId]
  );
  await testDb.query(`INSERT INTO stocks (product_id, available_whole_items) VALUES ($1, 5)`, [productId]);

  const place = (userKey, units) => fetch(`${base}/api/mini/v1/orders`, {
    method: 'POST', headers: users[userKey].auth,
    body: JSON.stringify({ productId, units, addressId: users[userKey].addressId, idempotencyKey: randomUUID() })
  }).then((r) => r.json());

  /**
   * 构造并投递微信回调（真实签名 + 真实加密报文）。
   * opts.pretty：报文带空白换行（验证 rawBody 保留）；opts.signKey：错误私钥；opts.omitHeaders：缺头；
   * opts.reserialize：签名后改变报文（重新序列化攻击）；opts.eventType：REFUND.* 退款事件。
   */
  const postNotify = async (rawBody, headers) => fetch(`${base}/api/payments/v1/notify`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: rawBody });
  const signedHeaders = (rawBody, signKey = platform.privateKey, omit = []) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(8).toString('hex');
    const headers = {
      'Wechatpay-Serial': SERIAL,
      'Wechatpay-Signature': rsaSign(signKey, `${timestamp}\n${nonce}\n${rawBody}\n`),
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce
    };
    for (const key of omit) delete headers[key];
    return headers;
  };
  const buildNotifyRaw = (payload, { eventType = 'TRANSACTION.SUCCESS', aad = 'transaction', pretty = false } = {}) => {
    const nonce = randomBytes(8).toString('hex');
    const ciphertext = makeCiphertext(JSON.stringify(payload), nonce, APIV3, aad);
    return JSON.stringify({
      id: `evt-${randomBytes(6).toString('hex')}`,
      event_type: eventType,
      resource_type: 'encrypt-resource',
      resource: { original_type: eventType.startsWith('REFUND') ? 'refund' : 'transaction', algorithm: 'AEAD_AES_256_GCM', ciphertext, nonce, associated_data: aad }
    }, null, pretty ? 2 : undefined);
  };
  const paymentPayload = (orderId, payerTotal) => ({ mchid: MCHID, out_trade_no: orderId, transaction_id: `wx-tx-${orderId.slice(-6)}`, trade_state: 'SUCCESS', amount: { total: payerTotal, payer_total: payerTotal }, payer: { openid: 'o-1' } });
  const sendNotify = async (orderId, payerTotal, opts = {}) => {
    const raw = buildNotifyRaw(paymentPayload(orderId, payerTotal), opts);
    return postNotify(raw, signedHeaders(raw, opts.signKey, opts.omitHeaders));
  };

  const payOrder = async (userKey, orderId) => fetch(`${base}/api/mini/v1/orders/${orderId}/pay`, { method: 'POST', headers: users[userKey].auth });
  const refreshResult = async (userKey, orderId) => fetch(`${base}/api/mini/v1/orders/${orderId}/payment-result`, { method: 'POST', headers: users[userKey].auth });

  const refundRows = async (orderId) => (await testDb.query('SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at', [orderId])).rows;
  const paymentRow = async (orderId) => (await testDb.query('SELECT * FROM payments WHERE order_id = $1', [orderId])).rows[0];
  const groupRow = async (groupId) => (await testDb.query('SELECT * FROM groups WHERE id = $1', [groupId])).rows[0];
  const stockRow = async () => (await testDb.query('SELECT available_whole_items AS a, reserved_whole_items AS r FROM stocks WHERE product_id = $1', [productId])).rows[0];

  // 生产任务装配（真实任务类 + 测试库；各场景共用）
  const { ExpireReservationsTask, FailDeadlineGroupsTask } = await import(dist('workflows/order-expiry.tasks.js'));
  const { PostgresGroupRepository, PostgresShareReservationRepository } = await import(dist('contexts/group-buying/adapters/outbound/postgres/group-repositories.js'));
  const { PostgresOrderRepository } = await import(dist('contexts/ordering/adapters/outbound/postgres/order-repository.js'));
  const { PostgresPaymentRepository } = await import(dist('contexts/payments/adapters/outbound/postgres/payment-repository.js'));
  const { PostgresRefundRepository } = await import(dist('contexts/payments/adapters/outbound/postgres/refund-repository.js'));
  const { getStockReservationPort } = await import(dist('contexts/catalog/adapters/outbound/catalog-stock-adapters.js'));
  const { RefundDriveTask } = await import(dist('workflows/payment-tasks.js'));
  const { CreateFullRefundUseCase } = await import(dist('contexts/payments/application/refund-flow.js'));
  const { CancelPaidOrderWorkflow } = await import(dist('contexts/payments/application/refund-flow.js'));
  const { HttpWxPayAdapter } = await import(dist('contexts/payments/adapters/outbound/wechat/wx-pay.adapter.js'));
  const expiryPool = new pg.Pool({ connectionString: database.testUrl, max: 2 });
  const runner = { async run(work) { const c = await expiryPool.connect(); try { await c.query('BEGIN'); const r = await work(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } } };
  const clock = { now: () => new Date() };
  const expiryDeps = {
    groups: new PostgresGroupRepository(expiryPool),
    reservations: new PostgresShareReservationRepository(expiryPool),
    orders: new PostgresOrderRepository(expiryPool),
    stocks: getStockReservationPort(expiryPool),
    runner,
    clock
  };
  const pgPayments = new PostgresPaymentRepository(expiryPool);
  const pgRefunds = new PostgresRefundRepository(expiryPool);
  const refundCreator = new CreateFullRefundUseCase({ refunds: pgRefunds, payments: pgPayments, clock });
  const channel = new HttpWxPayAdapter({ configured: true, mchid: MCHID, appid: APPID, apiV3Key: APIV3, privateKeyPath: merchantKeyPath, serialNo: SERIAL, notifyUrl: '', endpointBase: `http://127.0.0.1:${wxPort}` });
  const driver = new RefundDriveTask({ refunds: pgRefunds, payments: pgPayments, channel, runner, clock });
  const deadlineTask = new FailDeadlineGroupsTask({ ...expiryDeps, payments: pgPayments, refunds: { createFullRefund: (input, sessionTx) => refundCreator.execute(input, sessionTx) } });

  // ================= 场景 0：回调强制验签（A01） =================
  const unknownOrder = '99999999-9999-4999-8999-999999999999';
  // 缺全部签名头 → 400
  const noHeaders = await postNotify(buildNotifyRaw(paymentPayload(unknownOrder, 1)), { 'Content-Type': 'application/json' });
  assert.equal(noHeaders.status, 400);
  assert.equal((await noHeaders.json()).code, 'NOTIFY_INVALID');
  // 错误私钥签名 → 400
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const forged = buildNotifyRaw(paymentPayload(unknownOrder, 1));
  assert.equal((await postNotify(forged, signedHeaders(forged, attacker.privateKey))).status, 400);
  // 重新序列化攻击：签名对原文，投递压缩后报文 → 400
  const pretty = buildNotifyRaw(paymentPayload(unknownOrder, 1), { pretty: true });
  const compact = JSON.stringify(JSON.parse(pretty));
  assert.equal((await postNotify(compact, signedHeaders(pretty))).status, 400, '重新序列化报文验签拒绝');
  // 原文（含空白换行）+ 原文签名 → 验签通过、本地无单仅记录（200）
  assert.equal((await postNotify(pretty, signedHeaders(pretty))).status, 200, 'rawBody 保留：原文验签通过');

  // ================= 场景 1：三笔 1/3 支付生效 → 组满成功 + 库存消耗 + 金额守恒 + 让利台账 =================
  const o1 = await place('ua', 20);
  const o2 = await place('ub', 20);
  const o3 = await place('uc', 20);
  assert.equal(o1.data.status, 'unpaid');
  const groupId = o1.data.groupId;
  assert.equal([o2.data.groupId, o3.data.groupId].every((g) => g === groupId), true, '三笔进同组');
  assert.equal(o1.data.quote.totalAmountFen, 16833);
  assert.deepEqual(Object.values(await stockRow()).map(Number), [4, 1], '建组预留一件：available 4 / reserved 1');

  // 发起支付：真实适配器 → 本地假渠道下单
  const pay1 = await (await payOrder('ua', o1.data.id)).json();
  assert.equal(pay1.data.status, 'processing', '返回调起参数');
  assert.equal(pay1.data.payParams.package, 'prepay_id=prep-1', 'prepay_id 来自假渠道');
  assert.equal((await paymentRow(o1.data.id)).status, 'processing');
  assert.equal(wxRequests[0].url, '/v3/pay/transactions/jsapi', '真实适配器发起官方下单路径');

  // 回调与查询并发（第三轮 R13）：两条通道同时触发确认 → exactly-once，容量只加一次
  const [concurrentNotify, concurrentRefresh] = await Promise.all([
    sendNotify(o1.data.id, 16833),
    refreshResult('ua', o1.data.id)
  ]);
  assert.equal(concurrentNotify.status, 200);
  assert.equal(concurrentRefresh.status, 200);
  assert.equal((await paymentRow(o1.data.id)).status, 'succeeded');
  assert.equal((await paymentRow(o1.data.id)).applied_result, 'applied');
  assert.equal((await groupRow(groupId)).paid_units, 20, '并发确认 exactly-once：paid 0→20 仅一次');

  // 回调 SUCCESS（重复通知幂等）→ 状态保持
  const notify1 = await sendNotify(o1.data.id, 16833);
  assert.equal(notify1.status, 200);
  assert.equal((await paymentRow(o1.data.id)).status, 'succeeded');
  assert.equal((await groupRow(groupId)).paid_units, 20, '预占转换：paid 20 不变');
  const o1After = await (await fetch(`${base}/api/mini/v1/orders/${o1.data.id}`, { headers: users.ua.auth })).json();
  assert.equal(o1After.data.status, 'paid');

  // 重复通知幂等：同事实再投递 → 200、不重复加容量、组金额不变
  const dupNotify = await sendNotify(o1.data.id, 16833);
  assert.equal(dupNotify.status, 200);
  assert.equal((await groupRow(groupId)).paid_units, 20, '重复通知不重复计容量');
  assert.equal((await groupRow(groupId)).paid_amount_fen, 16833, '重复通知不重复计金额');

  // 金额不符 → pending_review 异常（人工处理入口；订单随预占过期失效）
  const pay2 = await (await payOrder('ub', o2.data.id)).json();
  assert.equal(pay2.data.status, 'processing');
  const badNotify = await sendNotify(o2.data.id, 16800);
  assert.equal(badNotify.status, 200, '验签通过即受理');
  assert.equal((await paymentRow(o2.data.id)).status, 'succeeded');
  assert.equal((await paymentRow(o2.data.id)).applied_result, 'pending_review', '金额不符转人工复核');
  assert.equal((await groupRow(groupId)).paid_units, 20, '金额不符不生效');

  // o2 预占过期释放（过期任务），ub 重新下单补位
  await testDb.query(`UPDATE share_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = $1`, [o2.data.id]);
  await new ExpireReservationsTask(expiryDeps).execute({ limit: 100 });
  assert.equal((await testDb.query('SELECT status FROM orders WHERE id = $1', [o2.data.id])).rows[0].status, 'expired');
  const o2b = await place('ub', 20);
  assert.equal(o2b.data.groupId, groupId, '释放后 ub 重买进同组');
  const pay2b = await (await payOrder('ub', o2b.data.id)).json();
  assert.equal(pay2b.data.status, 'processing');

  // R7 刷新语义：processing 单刷新 → 后端渠道查单 → 确认生效（不依赖回调）
  await refreshResult('ub', o2b.data.id);
  assert.equal((await paymentRow(o2b.data.id)).applied_result, 'applied', '刷新触发查单确认');
  assert.ok(wxRequests.some((r) => r.url.startsWith('/v3/pay/transactions/out-trade-no/')), '刷新走官方查单路径');
  assert.equal((await testDb.query('SELECT status FROM orders WHERE id = $1', [o2b.data.id])).rows[0].status, 'paid');
  // 已支付单刷新不再访问渠道（本地事实返回）
  const wxCountBefore = wxRequests.length;
  await refreshResult('ub', o2b.data.id);
  assert.equal(wxRequests.length, wxCountBefore, '已支付刷新不查渠道');

  // 第三笔支付生效 → 组满 60 → 组 success + 整件消耗
  const pay3 = await (await payOrder('uc', o3.data.id)).json();
  assert.equal(pay3.data.status, 'processing');
  const notify3 = await sendNotify(o3.data.id, 16833);
  assert.equal(notify3.status, 200);
  const groupAfterFull = await groupRow(groupId);
  assert.equal(groupAfterFull.status, 'success', '60 单位组满即成功');
  assert.equal(groupAfterFull.paid_units, 60);
  assert.deepEqual(Object.values(await stockRow()).map(Number), [4, 0], '组成功整件消耗：reserved 1→0');
  // 金额守恒：Σ已支付订单应付 = 组金额累计（16833×3=50499 ≤ 整件价 50500）
  const sumOrders = (await testDb.query('SELECT COALESCE(SUM(total_amount_fen),0)::int AS s FROM orders WHERE group_id = $1 AND status = $2', [groupId, 'paid'])).rows[0].s;
  assert.equal(sumOrders, (await groupRow(groupId)).paid_amount_fen, 'Σ已支付订单金额 = 组金额快照累计');
  // D006 让利台账（A05）：组成功同事务落账，expected/settled/diff 可追溯
  const settlement = (await testDb.query('SELECT * FROM group_settlements WHERE group_id = $1', [groupId])).rows[0];
  assert.ok(settlement, '组成功落台账');
  assert.equal(settlement.expected_total_fen, 50500, '整件售价快照 = 50000 + 500');
  assert.equal(settlement.settled_total_fen, 50499, 'Σ已支付订单应付');
  assert.equal(settlement.diff_fen, 1, '平台让利 1 分可追溯');

  // ================= 场景 2：迟到支付（预占过期后回调）→ D008 全额自动退款 + 退款驱动到账 =================
  const o4 = await place('ud', 15);
  assert.notEqual(o4.data.groupId, groupId, '满组不可加入 → 新组');
  assert.equal(o4.data.quote.totalAmountFen, 12625, '新组首单 1/4 标准价');
  const pay4 = await (await payOrder('ud', o4.data.id)).json();
  assert.equal(pay4.data.status, 'processing');
  const group2Id = o4.data.groupId;

  await testDb.query(`UPDATE share_reservations SET expires_at = now() - interval '1 minute' WHERE order_id = $1`, [o4.data.id]);
  await new ExpireReservationsTask(expiryDeps).execute({ limit: 100 });
  assert.equal((await testDb.query('SELECT status FROM orders WHERE id = $1', [o4.data.id])).rows[0].status, 'expired', '预占过期后订单失效');

  const lateNotify = await sendNotify(o4.data.id, 12625);
  assert.equal(lateNotify.status, 200);
  assert.equal((await paymentRow(o4.data.id)).applied_result, 'refunded_not_applied', '不可生效支付记录不适用');
  let refunds4 = await refundRows(o4.data.id);
  assert.equal(refunds4.length, 1);
  assert.equal(refunds4[0].status, 'requested');
  assert.equal(refunds4[0].amount_fen, 12625, '全额退款（含服务费）');
  assert.equal(refunds4[0].reason, 'late_payment');

  // 退款驱动（真实适配器 → 假渠道）：requested → processing → 退款回调 SUCCESS → succeeded（R6 回调路径）
  await driver.execute({ limit: 100 });
  refunds4 = await refundRows(o4.data.id);
  assert.equal(refunds4[0].status, 'processing', '渠道受理 → processing');
  const refundNotifyRaw = buildNotifyRaw(
    { mchid: MCHID, out_refund_no: refunds4[0].out_refund_no, refund_id: 'wxr-cb-1', refund_status: 'SUCCESS', amount: { refund: 12625 } },
    { eventType: 'REFUND.SUCCESS', aad: 'refund' }
  );
  const refundNotify = await postNotify(refundNotifyRaw, signedHeaders(refundNotifyRaw));
  assert.equal(refundNotify.status, 200, '退款回调验签受理');
  refunds4 = await refundRows(o4.data.id);
  assert.equal(refunds4[0].status, 'succeeded', '退款回调（渠道证据）→ 已退款');
  assert.equal(refunds4[0].channel_refund_id, 'wxr-cb-1');
  assert.ok(wxRequests.some((r) => r.url === '/v3/refund/domestic/refunds'), '真实适配器发起官方退款路径');

  // 小程序退款进度端点：本人可见（expired 订单，A04 语义），他人 404
  const myRefunds = await (await fetch(`${base}/api/mini/v1/orders/${o4.data.id}/refunds`, { headers: users.ud.auth })).json();
  assert.equal(myRefunds.data.items.length, 1);
  assert.equal(myRefunds.data.items[0].status, 'succeeded');
  assert.equal(myRefunds.data.items[0].amountFen, 12625);
  await expectHttpError(fetch(`${base}/api/mini/v1/orders/${o4.data.id}/refunds`, { headers: users.ua.auth }), 404, 'NOT_FOUND');

  // ================= 场景 3：取消退款失败重试 + 真实 PG 故障注入（事务回滚一致性） =================
  const o5 = await place('ue', 15);
  const pay5 = await (await payOrder('ue', o5.data.id)).json();
  assert.equal(pay5.data.status, 'processing');
  await sendNotify(o5.data.id, 12625);
  assert.equal((await paymentRow(o5.data.id)).applied_result, 'applied');

  // 故障注入（真实 PG）：取消流程中组扣减失败 → 退款单回滚，不留孤立可被 Worker 处理的退款单
  const failingGroups = new PostgresGroupRepository(expiryPool);
  const injected = new CancelPaidOrderWorkflow({
    groups: {
      findByIdForUpdate: (id, tx) => failingGroups.findByIdForUpdate(id, tx),
      deductPaidForCancel: async () => { throw new Error('注入：组扣减失败'); }
    },
    orders: expiryDeps.orders,
    payments: pgPayments,
    refunds: pgRefunds,
    creator: refundCreator,
    runner,
    clock
  });
  await assert.rejects(() => injected.execute({ userId: users.ue.id, orderId: o5.data.id, requestId: 'req-inject' }), /注入：组扣减失败/);
  assert.equal((await refundRows(o5.data.id)).length, 0, '回滚：无孤立退款单');
  assert.equal((await testDb.query('SELECT status FROM orders WHERE id = $1', [o5.data.id])).rows[0].status, 'paid', '回滚：订单保持 paid');
  assert.equal((await groupRow(o5.data.groupId)).paid_units, 15, '回滚：组容量未被扣减');

  // 真实取消（组 open）：容量即扣 + 全额退款单（同事务，此次成功）
  const cancelRes = await fetch(`${base}/api/mini/v1/orders/${o5.data.id}/cancel`, { method: 'POST', headers: users.ue.auth });
  assert.equal(cancelRes.status, 200);
  assert.equal((await testDb.query('SELECT status FROM orders WHERE id = $1', [o5.data.id])).rows[0].status, 'cancelled');
  const refunds5Before = await refundRows(o5.data.id);
  assert.equal(refunds5Before[0].reason, 'user_cancel');
  assert.equal((await groupRow(o5.data.groupId)).paid_units, 0, '取消即扣容量（D007）');

  // 渠道提交失败 → failed（异常队列可见）
  refundSubmitMode = 'fail';
  await driver.execute({ limit: 100 });
  let refunds5 = await refundRows(o5.data.id);
  assert.equal(refunds5[0].status, 'failed', '渠道提交异常落 failed');
  assert.match(refunds5[0].fail_reason ?? '', /SYSTEM_ERROR/);

  // 管理员登录 → 退款重试（审计）→ 驱动重提 → 退款回调到账
  await new Promise((res, rej) => {
    const child = spawn(process.execPath, ['backend/dist/bootstrap/create-admin.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl, ADMIN_INITIAL_USERNAME: 'root', ADMIN_INITIAL_PASSWORD: 't006-admin-pass' }, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? res() : rej(new Error('create-admin 失败'))));
  });
  const adminLogin = await (await fetch(`${base}/api/admin/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'root', password: 't006-admin-pass' }) })).json();
  const adminAuth = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${adminLogin.data.token}` });

  const anomalies2 = await (await fetch(`${base}/api/admin/v1/payment-anomalies`, { headers: adminAuth() })).json();
  assert.equal(anomalies2.data.pendingReviewPayments, 1, '金额不符支付在异常队列');
  const failedList = await (await fetch(`${base}/api/admin/v1/refunds?status=failed`, { headers: adminAuth() })).json();
  assert.equal(failedList.data.total, 1, '失败退款在后台列表');
  assert.equal(failedList.data.items[0].amountFen, 12625);

  await expectHttpError(fetch(`${base}/api/admin/v1/refunds/${refunds5[0].id}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'x' }) }), 401, 'UNAUTHENTICATED');
  await expectHttpError(fetch(`${base}/api/admin/v1/refunds/${refunds5[0].id}/retry`, { method: 'POST', headers: users.ue.auth, body: JSON.stringify({ reason: 'x' }) }), 401, 'UNAUTHENTICATED');

  const retryRes = await fetch(`${base}/api/admin/v1/refunds/${refunds5[0].id}/retry`, { method: 'POST', headers: adminAuth(), body: JSON.stringify({ reason: '渠道恢复后重试' }) });
  assert.equal(retryRes.status, 200);
  refunds5 = await refundRows(o5.data.id);
  assert.equal(refunds5[0].status, 'requested', '重试重置为 requested');
  assert.equal(refunds5[0].retry_count, 1, '重试计数 +1');
  const auditRow = await testDb.query(`SELECT action FROM admin_operation_logs WHERE action = 'refund.retry' AND resource_id = $1`, [refunds5[0].id]);
  assert.equal(auditRow.rowCount, 1, '重试写操作审计');

  refundSubmitMode = 'ok';
  await driver.execute({ limit: 100 });
  refunds5 = await refundRows(o5.data.id);
  assert.equal(refunds5[0].status, 'processing');
  const refundNotify5 = buildNotifyRaw(
    { mchid: MCHID, out_refund_no: refunds5[0].out_refund_no, refund_id: 'wxr-cb-2', refund_status: 'SUCCESS', amount: { refund: 12625 } },
    { eventType: 'REFUND.SUCCESS', aad: 'refund' }
  );
  assert.equal((await postNotify(refundNotify5, signedHeaders(refundNotify5))).status, 200);
  refunds5 = await refundRows(o5.data.id);
  assert.equal(refunds5[0].status, 'succeeded', '重试后退款回调到账');

  // ================= 场景 4：组截止失败 → 已支付订单 group_failed 全额退款（A02） =================
  const o6 = await place('uf', 15);
  assert.equal(o6.data.groupId, group2Id, '加入组2（open，容量充足）');
  const pay6 = await (await payOrder('uf', o6.data.id)).json();
  assert.equal(pay6.data.status, 'processing');
  await sendNotify(o6.data.id, 12625);
  assert.equal((await paymentRow(o6.data.id)).applied_result, 'applied');

  await testDb.query(`UPDATE groups SET deadline = now() - interval '1 minute' WHERE id = $1`, [group2Id]);
  const deadlineProcessed = await deadlineTask.execute({ limit: 100 });
  assert.equal(deadlineProcessed, 2, '组失效 1 + 退款建单 1');
  const group2After = await groupRow(group2Id);
  assert.equal(group2After.status, 'failed', '组截止失败');
  const refunds6 = await refundRows(o6.data.id);
  assert.equal(refunds6.length, 1);
  assert.equal(refunds6[0].reason, 'group_failed');
  assert.equal(refunds6[0].amount_fen, 12625, '全额退款');
  assert.equal(refunds6[0].status, 'requested');
  // 幂等：重复执行不重复建单
  await deadlineTask.execute({ limit: 100 });
  assert.equal((await refundRows(o6.data.id)).length, 1, '重复执行不重复建退款');

  // ================= 场景 5：D006 台账不重复、组截止组无台账 =================
  const settlementCount = (await testDb.query('SELECT COUNT(*)::int AS c FROM group_settlements')).rows[0].c;
  assert.equal(settlementCount, 1, '仅组1（success）有台账；组截止失败不落账');

  await expiryPool.end();
});
