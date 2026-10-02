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
import {deflateSync} from 'node:zlib';
import {approvalPgScenarios} from './approval-pg-scenarios.mjs';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const dist = (rel) => pathToFileURL(join(root, 'backend/dist', rel)).href;
function testPng(){
  const chunk=(type,data)=>{const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc&1)?0xedb88320^(crc>>>1):crc>>>1;}const size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,body,check]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(128,0);header.writeUInt32BE(128,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(128*(1+128*3)))),chunk('IEND',Buffer.alloc(0))]);
}

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
     VALUES ($1, $2, $3, now() + interval '24 hours', 'failed', 30, 25250, 25000)`,
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
     VALUES ($1, $2, $3, 25250, 'succeeded', $4, 'prep-t008', 'wx-tx-t008', 'applied')`,
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
  // 独立审查 R01：用户撞用客服内部键，只返回本人普通消息。
  const collision = await fetch(`${base}/api/mini/v1/conversations/${cid}/messages`, {method:'POST',headers:auth.ua,body:JSON.stringify({clientMessageId:'ag-note',kind:'text',content:{text:'普通用户消息'}})});
  assert.equal(collision.status,201);
  const collisionBody=await collision.json();assert.equal(collisionBody.data.message.content.text,'普通用户消息');assert.equal(collisionBody.data.message.kind,'text');
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/${cid}/messages`,{method:'POST',headers:auth.ua,body:JSON.stringify({clientMessageId:'ag-note',kind:'text',content:{text:'变更内容'}})}),409,'MESSAGE_ID_CONFLICT');
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/${cid}/messages`,{method:'POST',headers:auth.ua,body:JSON.stringify({clientMessageId:'user-note',kind:'note',content:{text:'伪造内部备注'}})}),400,'VALIDATION_FAILED');
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
  assert.equal((await fetch(`${base}/api/mini/v1/conversations/${cid}/messages`,{method:'POST',headers:auth.ua,body:JSON.stringify({clientMessageId:'cm-card',kind:'card',content:{cardKind:'order',cardRefId:orderId}})})).status,200,'jsonb 卡片重试返回原消息');
  // 他人订单卡片 → 400（投影校验拒绝）
  await expectHttpError(fetch(`${base}/api/mini/v1/cards/order/${orderId}`, { headers: auth.ub }), 404, 'NOT_FOUND');
  const cardView = await (await fetch(`${base}/api/mini/v1/cards/order/${orderId}`, { headers: auth.ua })).json();
  assert.equal(cardView.data.order.orderNo, 'PO-T008-1');

  // ================= 场景 5：转工单 → 会话 converted → 消息拒发 =================
  const converted = await (await fetch(`${base}/api/admin/v1/cs/conversations/${cid}/convert-ticket`, { method: 'POST', headers: agentAuth, body: JSON.stringify({ type: 'shipment_issue', title: '发货问题', description: '用户咨询发货进度并要求跟进',orderId }) })).json();
  assert.equal(converted.data.ticket.status, 'open');
  const ticketId = converted.data.ticket.id;
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/${cid}/messages`, { method: 'POST', headers: auth.ua, body: JSON.stringify({ clientMessageId: 'cm-after', kind: 'text', content: { text: 'x' } }) }), 409, 'CONVERSATION_ENDED');

  // ================= 场景 6：售后受理 + 协调退款 + 重复退款拒绝 =================
  const refundBody={orderId,reason:'客服售后申请',clientRequestId:'refund-approval'};
  await expectHttpError(fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/refund`, { method: 'POST', headers: agentAuth, body: JSON.stringify(refundBody) }), 409, 'TICKET_STATE_CONFLICT', 'open 状态不能申请退款');
  const acceptTicket = await (await fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/accept`, { method: 'POST', headers: agentAuth })).json();
  assert.equal(acceptTicket.data.ticket.status, 'processing');
  const approval=(await (await fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/refund`,{method:'POST',headers:agentAuth,body:JSON.stringify(refundBody)})).json()).data.request;
  assert.equal(approval.status,'pending');assert.equal((await testDb.query('SELECT COUNT(*)::int c FROM refunds WHERE order_id=$1',[orderId])).rows[0].c,0,'申请不退款');
  const decision={decision:'approve',reason:'审核支付与售后事实后批准'};
  const reviewed=(await (await fetch(`${base}/api/admin/v1/after-sales/requests/${approval.id}/review`,{method:'POST',headers:agentAuth,body:JSON.stringify(decision)})).json()).data.request;
  const refund={data:{refundId:reviewed.resultId}};
  assert.ok(refund.data.refundId);
  // 同工单同订单重复执行返回已关联退款，不新增；另一个工单不能重复退同一支付。
  const repeated=await (await fetch(`${base}/api/admin/v1/after-sales/tickets/${ticketId}/refund`, { method: 'POST', headers: agentAuth, body: JSON.stringify(refundBody) })).json();assert.equal(repeated.data.request.resultId,refund.data.refundId);
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

  // R02：提交时拦截他人订单引用，而不是等退款时才发现。
  await expectHttpError(fetch(`${base}/api/mini/v1/tickets`,{method:'POST',headers:auth.ub,body:JSON.stringify({type:'refund_issue',title:'越权',description:'不能关联他人订单',orderId})}),404,'NOT_FOUND');

  // R09/R06/R07：并发建会话、真实在线自动分配、内部记录前置过滤、持久化读确认。
  const heartbeat=await fetch(`${base}/api/admin/v1/cs/heartbeat`,{method:'POST',headers:agentAuth});assert.equal(heartbeat.status,200);
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM cs_agent_presence')).rows[0].c,1);
  await testDb.query("CREATE FUNCTION slow_cs_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END; $$");
  await testDb.query('CREATE TRIGGER slow_cs_insert BEFORE INSERT ON cs_conversations FOR EACH ROW EXECUTE FUNCTION slow_cs_insert()');
  const creates=await Promise.all([fetch(`${base}/api/mini/v1/conversations`,{method:'POST',headers:auth.ub}),fetch(`${base}/api/mini/v1/conversations`,{method:'POST',headers:auth.ub})]);assert.deepEqual(creates.map(r=>r.status),[201,201]);
  const [first,second]=await Promise.all(creates.map(r=>r.json()));const backlog=first.data.conversation;
  assert.equal(backlog.id,second.data.conversation.id);assert.equal(backlog.status,'active');
  await testDb.query('DROP TRIGGER slow_cs_insert ON cs_conversations');
  await testDb.query("INSERT INTO cs_messages(conversation_id,seq,sender,kind,content,internal,client_message_id) SELECT $1,s,'agent','note',jsonb_build_object('text','private'),true,'note-'||s FROM generate_series(1,50) s",[backlog.id]);
  await testDb.query("INSERT INTO cs_messages(conversation_id,seq,sender,kind,content,internal,client_message_id) VALUES($1,51,'agent','text','{\"text\":\"可见答复\"}'::jsonb,false,'visible')",[backlog.id]);
  await testDb.query('UPDATE cs_conversations SET last_seq=51 WHERE id=$1',[backlog.id]);
  const page=(await (await fetch(`${base}/api/mini/v1/conversations/${backlog.id}/messages?afterSeq=0&limit=50`,{headers:auth.ub})).json()).data;
  assert.deepEqual(page.messages.map(m=>m.seq),[51]);assert.equal(page.nextSeq,51);
  assert.equal((await fetch(`${base}/api/mini/v1/conversations/${backlog.id}/read`,{method:'POST',headers:auth.ub,body:JSON.stringify({seq:51})})).status,200);
  assert.equal((await testDb.query('SELECT last_read_seq FROM cs_read_marks WHERE conversation_id=$1 AND actor_id=$2',[backlog.id,USER_B])).rows[0].last_read_seq,51);
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/${backlog.id}/messages`,{method:'POST',headers:auth.ub,body:JSON.stringify({clientMessageId:'foreign-card',kind:'card',content:{cardKind:'order',cardRefId:orderId}})}),404,'NOT_FOUND');
  const productCard=(await (await fetch(`${base}/api/mini/v1/cards/product/${PRODUCT}`,{headers:auth.ua})).json()).data;assert.equal(productCard.product.name,'客服测试苹果');assert.equal(productCard.product.originalPriceFen,50000);

  // 已结束的真实会话，原负责客服仍能读取历史。
  await fetch(`${base}/api/mini/v1/conversations/${backlog.id}/end`,{method:'POST',headers:auth.ub});
  assert.equal((await fetch(`${base}/api/admin/v1/cs/conversations/${backlog.id}/messages`,{headers:agentAuth})).status,200);

  // R03：通过触发器让工单 action 写入失败，退款必须一并回滚。
  const rollbackOrder=randomUUID();
  await testDb.query('INSERT INTO orders(id,order_no,user_id,product_id,group_id,units,status,total_amount_fen,goods_amount_fen,service_fee_fen,is_final_order,original_price_fen,unit,whole_quantity_text,reference_quantity_text,address_receiver_name,address_phone,address_province,address_city,address_district,address_detail,idempotency_key,reservation_expires_at,paid_at) SELECT $1,$2,user_id,product_id,group_id,units,status,total_amount_fen,goods_amount_fen,service_fee_fen,is_final_order,original_price_fen,unit,whole_quantity_text,reference_quantity_text,address_receiver_name,address_phone,address_province,address_city,address_district,address_detail,$3,reservation_expires_at,paid_at FROM orders WHERE id=$4',[rollbackOrder,'PO-ROLLBACK',randomUUID(),orderId]);
  await testDb.query("INSERT INTO payments(id,order_id,user_id,amount_fen,status,out_trade_no,applied_result) VALUES($1,$2,$3,25250,'succeeded',$4,'applied')",[randomUUID(),rollbackOrder,USER_A,`rollback-${rollbackOrder}`]);
  const newTicket=(await (await fetch(`${base}/api/mini/v1/tickets`,{method:'POST',headers:auth.ua,body:JSON.stringify({type:'refund_issue',title:'回滚',description:'真实数据库故障',orderId:rollbackOrder,clientTicketId:'rollback-ticket'})})).json()).data.ticket.id;
  await fetch(`${base}/api/admin/v1/after-sales/tickets/${newTicket}/accept`,{method:'POST',headers:agentAuth});
  const pendingRollback=(await (await fetch(`${base}/api/admin/v1/after-sales/tickets/${newTicket}/refund`,{method:'POST',headers:agentAuth,body:JSON.stringify({orderId:rollbackOrder,reason:'审核回滚场景',clientRequestId:'rollback-request'})})).json()).data.request;
  await testDb.query("CREATE FUNCTION reject_refund_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='approve_refund' THEN RAISE EXCEPTION 'test action failure'; END IF; RETURN NEW; END; $$");
  await testDb.query('CREATE TRIGGER reject_refund_action BEFORE INSERT ON after_sales_ticket_actions FOR EACH ROW EXECUTE FUNCTION reject_refund_action()');
  assert.equal((await fetch(`${base}/api/admin/v1/after-sales/requests/${pendingRollback.id}/review`,{method:'POST',headers:agentAuth,body:JSON.stringify(decision)})).status,500);
  assert.equal((await testDb.query('SELECT COUNT(*)::int AS c FROM refunds WHERE order_id=$1',[rollbackOrder])).rows[0].c,0);
  assert.equal((await testDb.query('SELECT related_refund_id FROM after_sales_tickets WHERE id=$1',[newTicket])).rows[0].related_refund_id,null);
  assert.equal((await testDb.query('SELECT status FROM after_sales_action_requests WHERE id=$1',[pendingRollback.id])).rows[0].status,'pending');
  assert.equal((await testDb.query('SELECT COUNT(*)::int c FROM fulfillment_refund_holds WHERE order_id=$1',[rollbackOrder])).rows[0].c,0);
  await testDb.query('DROP TRIGGER reject_refund_action ON after_sales_ticket_actions');
  const detail=(await (await fetch(`${base}/api/mini/v1/tickets/${ticketId}`,{headers:auth.ua})).json()).data;assert.ok(detail.actions.some(a=>a.action==='resolve'));
  const unhappyBody={satisfied:false,text:'仍未解决',clientActionId:'unhappy-retry'};
  const unhappy=(await (await fetch(`${base}/api/mini/v1/tickets/${ticketId}/feedback`,{method:'POST',headers:auth.ua,body:JSON.stringify(unhappyBody)})).json()).data;assert.equal(unhappy.ticket.status,'processing');
  assert.equal((await fetch(`${base}/api/mini/v1/tickets/${ticketId}/feedback`,{method:'POST',headers:auth.ua,body:JSON.stringify(unhappyBody)})).status,200);
  assert.equal((await testDb.query('SELECT COUNT(*)::int c FROM after_sales_ticket_actions WHERE ticket_id=$1 AND client_action_id=$2',[ticketId,'unhappy-retry'])).rows[0].c,1);

  // 两个不同的普通客服竞争接待，后台权限独立于隐藏按钮成立。
  const staff=[];
  for(const username of ['ordinary1','ordinary2']){
    const account=await fetch(`${base}/api/admin/v1/cs/accounts`,{method:'POST',headers:agentAuth,body:JSON.stringify({username,displayName:username,password:'test-only-pass-123',role:'cs_agent'})});
    assert.equal(account.status,201);const created=(await account.json()).data;
    const login=(await (await fetch(`${base}/api/admin/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'test-only-pass-123'})})).json()).data;
    staff.push({id:created.id,auth:{'Content-Type':'application/json',Authorization:`Bearer ${login.token}`}});
  }
  await expectHttpError(fetch(`${base}/api/admin/v1/cs/accounts`,{headers:staff[0].auth}),403,'FORBIDDEN');
  await expectHttpError(fetch(`${base}/api/admin/v1/after-sales/requests/${approval.id}/review`,{method:'POST',headers:staff[0].auth,body:JSON.stringify(decision)}),403,'FORBIDDEN');
  await testDb.query('DELETE FROM cs_agent_presence');
  const queued=(await (await fetch(`${base}/api/mini/v1/conversations`,{method:'POST',headers:auth.ub})).json()).data.conversation;
  const competition=await Promise.all(staff.map(s=>fetch(`${base}/api/admin/v1/cs/conversations/${queued.id}/accept`,{method:'POST',headers:s.auth})));
  assert.deepEqual(competition.map(r=>r.status).sort(),[200,409]);
  const winner=staff[competition.findIndex(r=>r.status===200)],loser=staff[competition.findIndex(r=>r.status===409)];
  await expectHttpError(fetch(`${base}/api/admin/v1/cs/conversations/${queued.id}/messages`,{headers:loser.auth}),404,'NOT_FOUND');

  // 私有附件真实字节校验、本人/负责客服可读、他人不可读、跨会话不可复用。
  const bytes=testPng();
  const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'test.png');
  const image=await fetch(`${base}/api/mini/v1/conversations/${queued.id}/images`,{method:'POST',headers:{Authorization:auth.ub.Authorization},body:form});
  assert.equal(image.status,201);const imageId=(await image.json()).data.id;
  const imageGet=await fetch(`${base}/api/mini/v1/chat-images/${imageId}`,{headers:auth.ub});assert.equal(imageGet.status,200);assert.match(imageGet.headers.get('content-type'),/image\/png/);assert.match(imageGet.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await imageGet.arrayBuffer()),bytes);
  await expectHttpError(fetch(`${base}/api/mini/v1/chat-images/${imageId}`,{headers:auth.ua}),404,'NOT_FOUND');
  assert.equal((await fetch(`${base}/api/admin/v1/cs/images/${imageId}`,{headers:winner.auth})).status,200);
  await expectHttpError(fetch(`${base}/api/admin/v1/cs/images/${imageId}`,{headers:loser.auth}),404,'NOT_FOUND');
  const cross=(await (await fetch(`${base}/api/mini/v1/conversations`,{method:'POST',headers:auth.ua})).json()).data.conversation;
  await expectHttpError(fetch(`${base}/api/mini/v1/conversations/${cross.id}/messages`,{method:'POST',headers:auth.ua,body:JSON.stringify({clientMessageId:'cross-image',kind:'image',content:{mediaAssetId:imageId}})}),404,'NOT_FOUND');

  // 用户工单幂等：真实并发同键只创建一张工单、一条 create。
  const payload={clientTicketId:'parallel-ticket',type:'other',title:'并发工单',description:'重试不能重复创建'};
  const same=await Promise.all([1,2].map(()=>fetch(`${base}/api/mini/v1/tickets`,{method:'POST',headers:auth.ub,body:JSON.stringify(payload)})));
  assert.deepEqual(same.map(r=>r.status),[201,201]);const twins=await Promise.all(same.map(r=>r.json()));assert.equal(twins[0].data.ticket.id,twins[1].data.ticket.id);
  assert.equal((await testDb.query("SELECT count(*)::int c FROM after_sales_ticket_actions WHERE ticket_id=$1 AND action='create'",[twins[0].data.ticket.id])).rows[0].c,1);
  await expectHttpError(fetch(`${base}/api/mini/v1/tickets`,{method:'POST',headers:auth.ub,body:JSON.stringify({...payload,title:'不同内容'})}),409,'IDEMPOTENCY_CONFLICT');
  await expectHttpError(fetch(`${base}/api/mini/v1/tickets?pageSize=-1`,{headers:auth.ub}),400,'VALIDATION_FAILED');

  // 真实生产审计失败：工单回复及客户端键必须回滚，恢复后同键只记一次。
  await testDb.query("CREATE FUNCTION reject_ticket_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ticket.reply' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END; $$");
  await testDb.query('CREATE TRIGGER reject_ticket_audit BEFORE INSERT ON admin_operation_logs FOR EACH ROW EXECUTE FUNCTION reject_ticket_audit()');
  const retryReply={text:'审计回滚后的重试',clientActionId:'audit-retry'};
  assert.equal((await fetch(`${base}/api/admin/v1/after-sales/tickets/${newTicket}/reply`,{method:'POST',headers:agentAuth,body:JSON.stringify(retryReply)})).status,500);
  assert.equal((await testDb.query('SELECT COUNT(*)::int c FROM after_sales_ticket_actions WHERE ticket_id=$1 AND client_action_id=$2',[newTicket,'audit-retry'])).rows[0].c,0);
  await testDb.query('DROP TRIGGER reject_ticket_audit ON admin_operation_logs');
  for(let i=0;i<2;i++)assert.equal((await fetch(`${base}/api/admin/v1/after-sales/tickets/${newTicket}/reply`,{method:'POST',headers:agentAuth,body:JSON.stringify(retryReply)})).status,200,'处理动作遵循约定的 HTTP 200');
  assert.equal((await testDb.query('SELECT COUNT(*)::int c FROM after_sales_ticket_actions WHERE ticket_id=$1 AND client_action_id=$2',[newTicket,'audit-retry'])).rows[0].c,1);

  // 停用客服后旧 token 被撤销。
  const approvalPool=new pg.Pool({connectionString:database.testUrl});
  try{await approvalPgScenarios({db:testDb,base,superAuth:agentAuth,staffAuth:winner.auth,loserAuth:loser.auth,userAuth:auth.ua,otherUserAuth:auth.ub,userId:USER_A,productId:PRODUCT,templateOrder:orderId,pool:approvalPool});}finally{await approvalPool.end();}
  assert.equal((await fetch(`${base}/api/admin/v1/cs/accounts/${loser.id}/status`,{method:'POST',headers:agentAuth,body:JSON.stringify({status:'disabled'})})).status,201);
  await expectHttpError(fetch(`${base}/api/admin/v1/cs/queue`,{headers:loser.auth}),401,'UNAUTHENTICATED');
});
