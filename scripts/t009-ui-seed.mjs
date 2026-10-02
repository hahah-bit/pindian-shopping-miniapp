// T009 浏览器交互验证辅助：建独立库、迁移、种子数据、启动 API（仅本机验证用，不入库为常规脚本可留作复验）。
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const envFile = await readFile(`${root}/.env`, 'utf8');
const envUrl = envFile.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const dbName = process.argv[2] ?? 'pindian_t009_ui_test';
const port = process.argv[3] ?? '3200';

const admin = new pg.Client({ connectionString: envUrl });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

const testUrl = new URL(envUrl);
testUrl.pathname = `/${dbName}`;

const migrate = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: 'inherit' });
await new Promise((res, rej) => migrate.on('exit', (c) => (c === 0 ? res('') : rej(new Error('迁移失败')))));

const db = new pg.Client({ connectionString: testUrl.toString() });
await db.connect();
const UA = randomUUID();
const UB = randomUUID();
const SUPER = randomUUID();
const AGENT = randomUUID();
await db.query(`INSERT INTO users (id, nickname, status) VALUES ($1,'看板甲','active'),($2,'看板乙','active')`, [UA, UB]);
await db.query(`INSERT INTO admins (id, username, display_name, password_hash, role, status) VALUES ($1,'ui-super','界面超管','$2a$10$CwTycbitWz8fN-formula','super_admin','active'),($2,'ui-agent','界面客服','$2a$10$CwTycbitWz8fN-formula','cs_agent','active')`, [SUPER, AGENT]);

const P = randomUUID();
const G1 = randomUUID();
await db.query(`INSERT INTO products (id, name, original_price_fen, whole_quantity, unit, allowed_share_units, status) VALUES ($1,'界面苹果',50000,10,'斤',ARRAY[30,20,15,12],'on_shelf')`, [P]);
await db.query(`INSERT INTO stocks (product_id, available_whole_items) VALUES ($1, 9)`, [P]);
const SNAPSHOT = JSON.stringify({ originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' });
await db.query(`INSERT INTO groups (id, product_id, sale_policy_snapshot, deadline, status, paid_units, created_at) VALUES ($1,$2,$3, now()+interval '24 hours','success',60, now() - interval '2 hours')`, [G1, P, SNAPSHOT]);
const O1 = randomUUID();
const O2 = randomUUID();
for (const [id, userId, no] of [[O1, UA, 'PO-UI-1'], [O2, UB, 'PO-UI-2']]) {
  await db.query(
    `INSERT INTO orders (id, order_no, user_id, product_id, group_id, units, status, total_amount_fen, goods_amount_fen, service_fee_fen, is_final_order, original_price_fen, unit, whole_quantity_text, reference_quantity_text,
      address_receiver_name, address_phone, address_province, address_city, address_district, address_detail, idempotency_key, reservation_expires_at, paid_at)
     VALUES ($1,$2,$3,$4,$5,30,'paid',25250,25000,250,false,50000,'斤','10','10','收','13800001230','广东省','深圳市','南山区','地址',$6, now()+interval '1 hour', now())`,
    [id, no, userId, P, G1, randomUUID()]
  );
  const pay = randomUUID();
  await db.query(`INSERT INTO payments (id, order_id, user_id, amount_fen, status, out_trade_no, applied_result) VALUES ($1,$2,$3,25250,'succeeded',$4,'applied')`, [pay, id, userId, `UI-${no}`]);
  if (id === O1) {
    await db.query(`INSERT INTO refunds (id, payment_id, order_id, user_id, out_refund_no, amount_fen, status, reason) VALUES ($1,$2,$3,$4,'UI-R1',25250,'succeeded','user_cancel')`, [randomUUID(), pay, id, userId]);
  }
  await db.query(
    `INSERT INTO fulfillment_orders (group_id, order_id, user_id, allocated_quantity_grams, unit, status, receiver_name, receiver_phone, receiver_province, receiver_city, receiver_district, receiver_detail)
     VALUES ($1,$2,$3,2500,'斤','pending_shipment','收','13800001230','广东省','深圳市','南山区','地址')`,
    [G1, id, userId]
  );
}
await db.query(`INSERT INTO cs_conversations (id, user_id, status, created_at) VALUES ($1,$2,'queued', now() - interval '20 minutes')`, [randomUUID(), UB]);
await db.query(`INSERT INTO after_sales_tickets (id, user_id, type, status, title, description) VALUES ($1,$2,'other','open','界面工单','d')`, [randomUUID(), UA]);
// 审计种子：带手机号
await db.query(`INSERT INTO admin_operation_logs (admin_id, action, resource_type, resource_id, detail) VALUES ($1,'fulfillment.update_receiver','fulfillment_order','fo-ui-1','{"phone":"13800001230","receiver":"界面收货人"}')`, [SUPER]);
await db.end();

// 初始管理员登录走 create-admin 重置密码逻辑不可行，直接造会话
const db2 = new pg.Client({ connectionString: testUrl.toString() });
await db2.connect();
const token = createHash('sha256').update('ui-super-token').digest('hex');
await db2.query(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [SUPER, token]);
const agentToken = createHash('sha256').update('ui-agent-token').digest('hex');
await db2.query(`INSERT INTO admin_sessions (admin_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [AGENT, agentToken]);
await db2.end();
console.log(`[seed] super token: ui-super-token`);
console.log(`[seed] agent token: ui-agent-token`);

const api = spawn(process.execPath, ['backend/dist/bootstrap/main.js'], { cwd: root, env: { ...process.env, PORT: port, DATABASE_URL: testUrl.toString(), MEDIA_DIR: 'data/media-ui', PUBLIC_API_BASE_URL: `http://127.0.0.1:${port}` }, stdio: 'inherit' });
api.on('exit', (c) => console.log(`[api] 退出 ${c}`));
