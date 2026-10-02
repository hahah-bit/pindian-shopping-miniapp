import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
  url.pathname = '/pindian_t009_audit_test';
  return { adminUrl: envUrl, testUrl: url.toString() };
}

const database = await resolveTestDatabase();
const skipReason = 'PostgreSQL 测试库不可达（启动 docker compose postgres 后重跑；skip 不代表通过）';

test('T009 F039 审计：分页/筛选/时间范围/脱敏与权限矩阵', { timeout: 240_000, skip: database ? false : skipReason }, async (context) => {
  assert.ok(database, skipReason);
  const admin = new pg.Client({ connectionString: database.adminUrl });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pindian_t009_audit_test WITH (FORCE)');
  await admin.query('CREATE DATABASE pindian_t009_audit_test');
  let closeDb = async () => {};
  context.after(async () => {
    await closeDb();
    await admin.end();
    if (process.env.PINDIAN_KEEP_TEST_DB !== '1') {
      const cleanup = new pg.Client({ connectionString: database.adminUrl });
      await cleanup.connect();
      await cleanup.query('DROP DATABASE IF EXISTS pindian_t009_audit_test WITH (FORCE)').catch(() => {});
      await cleanup.end();
    }
  });

  await new Promise((res, rej) => {
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['backend/dist/bootstrap/migrate.js'], { cwd: root, env: { ...process.env, DATABASE_URL: database.testUrl }, stdio: 'ignore' });
    child.on('exit', (code) => (code === 0 ? res('') : rej(new Error('迁移失败'))));
  });

  const { PostgresOperationLogQuery } = require('../../../backend/dist/contexts/audit/adapters/outbound/postgres/operation-log-query.js');
  const { AuditLogQueries } = require('../../../backend/dist/contexts/audit/application/audit-queries.js');
  const { roleMatrix } = require('../../../backend/dist/contexts/identity-access/application/role-matrix.js');

  const db = new pg.Pool({ connectionString: database.testUrl });
  closeDb = async () => { await db.end().catch(() => {}); };

  const ADMIN_A = randomUUID();
  const ADMIN_B = randomUUID();
  await db.query(`INSERT INTO admins (id, username, display_name, password_hash, role, status) VALUES ($1,'audit-a','审计甲','x','super_admin','active'), ($2,'audit-b','审计乙','x','catalog_admin','active')`, [ADMIN_A, ADMIN_B]);

  const shTime = (offsetDays, hh, mm) => {
    const base = new Date(Date.now() + 8 * 3600_000 + offsetDays * 86_400_000);
    const y = base.getUTCFullYear(), m = base.getUTCMonth(), d = base.getUTCDate();
    return new Date(Date.UTC(y, m, d, hh - 8, mm, 0));
  };
  const todayText = (() => { const t = new Date(Date.now() + 8 * 3600_000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; })();
  const yesterdayText = (() => { const t = new Date(Date.now() + 8 * 3600_000 - 86_400_000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; })();

  // 12 条日志：甲 8 条（fulfillment.ship ×5 / ticket.reply ×2 / user.phone_reveal ×1），乙 4 条（order.export）
  let seq = 0;
  async function seedLog({ adminId, action, resourceType, resourceId, detail, at }) {
    seq += 1;
    await db.query(
      `INSERT INTO admin_operation_logs (admin_id, action, resource_type, resource_id, detail, request_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [adminId, action, resourceType, resourceId, JSON.stringify(detail), `req-${seq}`, at]
    );
  }
  for (let i = 0; i < 5; i++) {
    await seedLog({ adminId: ADMIN_A, action: 'fulfillment.ship', resourceType: 'fulfillment_order', resourceId: `fo-${i}`, detail: { trackingNo: `SF-${i}` }, at: shTime(0, 10, i) });
  }
  await seedLog({ adminId: ADMIN_A, action: 'fulfillment.ship', resourceType: 'fulfillment_order', resourceId: 'fo-yesterday', detail: { trackingNo: 'SF-Y' }, at: shTime(-1, 23, 59) });
  await seedLog({ adminId: ADMIN_A, action: 'ticket.reply', resourceType: 'ticket', resourceId: 't-1', detail: { phone: '13800001230', version: 2 }, at: shTime(-1, 12, 0) });
  await seedLog({ adminId: ADMIN_A, action: 'user.phone_reveal', resourceType: 'user', resourceId: 'u-1', detail: { note: '联系 13998887777 处理' }, at: shTime(-3, 9, 30) });
  for (let i = 0; i < 4; i++) {
    await seedLog({ adminId: ADMIN_B, action: 'order.export', resourceType: 'order', resourceId: `o-${i}`, detail: { rows: i + 1 }, at: shTime(0, 11, i) });
  }
  // 今天 00:01 的边界行（归今天，不归昨天）
  await seedLog({ adminId: ADMIN_A, action: 'ticket.reply', resourceType: 'ticket', resourceId: 't-midnight', detail: {}, at: shTime(0, 0, 1) });

  const queries = new AuditLogQueries({ queryPort: new PostgresOperationLogQuery(db), clock: { now: () => new Date() } });

  await context.test('分页：总数、排序稳定、页内容', async () => {
    const page1 = await queries.listLogs({ page: 1, pageSize: 5 });
    assert.equal(page1.total, 13);
    assert.equal(page1.items.length, 5);
    const times = page1.items.map((r) => new Date(r.createdAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a), 'created_at 降序');
    const page3 = await queries.listLogs({ page: 3, pageSize: 5 });
    assert.equal(page3.items.length, 3);
    const ids = new Set([...page1.items, ...page3.items].map((r) => r.id));
    assert.equal(ids.size, 8, '页间不重复');
  });

  await context.test('筛选：动作前缀/资源类型/管理员', async () => {
    const ships = await queries.listLogs({ action: 'fulfillment.ship', page: 1, pageSize: 50 });
    assert.equal(ships.total, 6);
    assert.ok(ships.items.every((r) => r.action === 'fulfillment.ship'));
    const tickets = await queries.listLogs({ resourceType: 'ticket', page: 1, pageSize: 50 });
    assert.equal(tickets.total, 2, 'ticket 资源共 2 条（t-1 与 t-midnight）');
    const byB = await queries.listLogs({ adminId: ADMIN_B, page: 1, pageSize: 50 });
    assert.equal(byB.total, 4);
    assert.ok(byB.items.every((r) => r.adminDisplayName === '审计乙'));
    // LIKE 通配符转义：% 不作通配符
    const literal = await queries.listLogs({ action: '%', page: 1, pageSize: 50 });
    assert.equal(literal.total, 0);
  });

  await context.test('时间范围：上海日界，to 含当日全天', async () => {
    const yesterday = await queries.listLogs({ from: yesterdayText, to: yesterdayText, page: 1, pageSize: 50 });
    assert.equal(yesterday.total, 2, '昨日 23:59 与 12:00 两条（今日 00:01 不归昨日）');
    const range = await queries.listLogs({ from: yesterdayText, to: todayText, page: 1, pageSize: 50 });
    assert.equal(range.total, 12);
  });

  await context.test('脱敏：键与裸手机号两路掩码，库内原文不变', async () => {
    const tickets = await queries.listLogs({ resourceType: 'ticket', page: 1, pageSize: 50 });
    const ticketsText = JSON.stringify(tickets);
    assert.match(ticketsText, /138\*\*\*\*1230/, 'phone 键值掩码');
    assert.doesNotMatch(ticketsText, /13800001230/);
    const reveal = await queries.listLogs({ action: 'user.phone_reveal', page: 1, pageSize: 50 });
    const revealText = JSON.stringify(reveal);
    assert.match(revealText, /139\*\*\*\*7777/, '正文字符串中的裸手机号掩码');
    assert.doesNotMatch(revealText, /13998887777/);
    const raw = await db.query(`SELECT detail FROM admin_operation_logs WHERE resource_type='ticket'`);
    assert.equal(JSON.stringify(raw.rows).includes('13800001230'), true, '库内原文不改（响应层脱敏）');
  });

  await context.test('非法日期拒绝', async () => {
    await assert.rejects(() => queries.listLogs({ from: '2026-02-30', page: 1, pageSize: 10 }), (e) => e.code === 'VALIDATION_FAILED');
    await assert.rejects(() => queries.listLogs({ to: 'bad', page: 1, pageSize: 10 }), (e) => e.code === 'VALIDATION_FAILED');
  });

  await context.test('权限矩阵：静态映射与角色标签（D025）', async () => {
    const matrix = roleMatrix();
    assert.equal(matrix.roles.length, 4);
    const superRole = matrix.roles.find((r) => r.role === 'super_admin');
    assert.equal(superRole.label, '超级管理员');
    for (const code of ['reporting:view', 'reporting:view_cs', 'audit:view', 'notification:manage']) {
      assert.ok(superRole.permissions.includes(code), `super_admin 含 ${code}`);
    }
    const supervisor = matrix.roles.find((r) => r.role === 'cs_supervisor');
    assert.ok(supervisor.permissions.includes('reporting:view_cs'));
    assert.equal(supervisor.permissions.includes('reporting:view'), false, '客服主管不含总览权限');
    assert.equal(supervisor.permissions.includes('audit:view'), false);
    const agent = matrix.roles.find((r) => r.role === 'cs_agent');
    assert.deepEqual(agent.permissions, ['agent:manage'], '普通客服不新增任何看板/审计权限');
    const catalog = matrix.roles.find((r) => r.role === 'catalog_admin');
    assert.equal(catalog.permissions.includes('reporting:view'), false);
  });
});
