import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { User, maskPhone } = require('../../../backend/dist/contexts/identity-access/domain/user/index.js');
const {
  ListAdminUsers,
  GetAdminUser,
  RevealUserPhone,
  DisableUser,
  EnableUser
} = require('../../../backend/dist/contexts/identity-access/application/user/admin-users.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-01T00:00:00Z');
const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const ADMIN_ID = 'cccccccc-3333-4333-8333-333333333333';

class FakeClock { now() { return NOW; } }

class InMemoryUserRepository {
  constructor(seed = []) { this.users = new Map(seed.map((u) => [u.state.userId, u])); }
  async findById(id) { return this.users.get(id) ?? null; }
  async findByIdIfActive(id) { const u = this.users.get(id); return u && u.state.status === 'active' ? u : null; }
  async save(u) { this.users.set(u.state.userId, u); }
  async updateStatus(id, status, at) {
    const u = this.users.get(id);
    if (!u) return false;
    this.users.set(id, status === 'disabled' ? u.disable(at) : u.enable(at));
    return true;
  }
  async listUsers({ keyword, status, page, pageSize }) {
    let items = [...this.users.values()];
    if (keyword) items = items.filter((u) => u.state.nickname.includes(keyword));
    if (status) items = items.filter((u) => u.state.status === status);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
  }
}

class InMemoryUserSessions {
  constructor() { this.sessions = new Map(); }
  async save(s) { this.sessions.set(s.state.sessionId, s); }
  async findByTokenHash(h) { return null; }
  async findBySessionId(id) { return this.sessions.get(id) ?? null; }
  async revoke(id, at) { const s = this.sessions.get(id); if (s) this.sessions.set(id, s.revoke(at)); }
  async revokeAllForUser(userId, at) {
    this.revokedAll = this.revokedAll || [];
    this.revokedAll.push(userId);
    for (const [id, s] of this.sessions) if (s.state.userId === userId) this.sessions.set(id, s.revoke(at));
  }
  async deleteExpired() { return 0; }
}

class InMemoryAudit {
  constructor() { this.logs = []; }
  async execute(input) { this.logs.push(input); }
}

async function expectRejection(factory, code) {
  try { await factory(); }
  catch (error) {
    assert.ok(error instanceof ApplicationError, `应抛 ApplicationError，实际 ${error}`);
    assert.equal(error.code, code, `${error.code} !== ${code}: ${error.message}`);
    return error;
  }
  assert.fail(`应抛出 ${code}，但调用成功了`);
}

function seedUsers(repo) {
  const active = User.create({ userId: USER_A, nickname: '拼单小明', now: NOW }).bindPhone('13800001234', '86', 'wechat_quick_verify', NOW).recordLogin(NOW);
  const disabled = User.create({ userId: USER_B, nickname: '普通用户B', now: NOW }).disable(NOW);
  repo.save(active);
  repo.save(disabled);
  return { active, disabled };
}

function buildStack() {
  const users = new InMemoryUserRepository();
  const sessions = new InMemoryUserSessions();
  const audit = new InMemoryAudit();
  const deps = { users, sessions, audit, clock: new FakeClock() };
  return {
    users, sessions, audit,
    list: new ListAdminUsers(deps),
    get: new GetAdminUser(deps),
    reveal: new RevealUserPhone(deps),
    disable: new DisableUser(deps),
    enable: new EnableUser(deps)
  };
}

test('列表：脱敏投影（不出现手机号原文）、分页与筛选（G17）', async () => {
  const stack = buildStack();
  seedUsers(stack.users);
  const page = await stack.list.execute({ page: 1, pageSize: 10 });
  assert.equal(page.total, 2);
  const a = page.items.find((i) => i.id === USER_A);
  assert.equal(a.phoneMasked, '138****1234');
  assert.equal(a.hasPhone, true);
  assert.equal(a.status, 'active');
  assert.ok(a.lastLoginAt);
  const raw = JSON.stringify(page);
  assert.ok(!raw.includes('13800001234'), '列表响应不包含手机号原文');
  const filtered = await stack.list.execute({ status: 'disabled', page: 1, pageSize: 10 });
  assert.equal(filtered.total, 1);
  const keyword = await stack.list.execute({ keyword: '小明', page: 1, pageSize: 10 });
  assert.equal(keyword.total, 1);
});

test('详情：同构脱敏视图；不存在 404', async () => {
  const stack = buildStack();
  seedUsers(stack.users);
  const view = await stack.get.execute({ userId: USER_A });
  assert.equal(view.nickname, '拼单小明');
  assert.ok(!JSON.stringify(view).includes('13800001234'));
  await expectRejection(() => stack.get.execute({ userId: '00000000-0000-4000-8000-000000000000' }), 'NOT_FOUND');
});

test('查看完整手机号：返回原文并强制写审计，审计不含原文（G16）', async () => {
  const stack = buildStack();
  seedUsers(stack.users);
  const revealed = await stack.reveal.execute({ userId: USER_A, adminId: ADMIN_ID, requestId: 'req-1' });
  assert.equal(revealed.phone, '13800001234');
  assert.equal(revealed.countryCode, '86');
  assert.equal(stack.audit.logs.length, 1);
  assert.equal(stack.audit.logs[0].action, 'user.phone_revealed');
  assert.equal(stack.audit.logs[0].resourceId, USER_A);
  assert.ok(!JSON.stringify(stack.audit.logs).includes('13800001234'), '审计记录不含手机号原文');
  // 无手机号用户：404
  await expectRejection(() => stack.reveal.execute({ userId: USER_B, adminId: ADMIN_ID, requestId: 'req-2' }), 'NOT_FOUND');
});

test('禁用：状态迁移 + 撤销全部会话 + 审计；幂等；启用恢复（G18）', async () => {
  const stack = buildStack();
  seedUsers(stack.users);
  await stack.disable.execute({ userId: USER_A, adminId: ADMIN_ID, requestId: 'req-d1' });
  assert.equal((await stack.users.findById(USER_A)).state.status, 'disabled');
  assert.deepEqual(stack.sessions.revokedAll, [USER_A], '撤销该用户全部会话');
  await stack.disable.execute({ userId: USER_A, adminId: ADMIN_ID, requestId: 'req-d2' });
  assert.equal((await stack.users.findById(USER_A)).state.status, 'disabled', '重复禁用幂等');
  await stack.enable.execute({ userId: USER_A, adminId: ADMIN_ID, requestId: 'req-e1' });
  assert.equal((await stack.users.findById(USER_A)).state.status, 'active');
  const actions = stack.audit.logs.map((l) => l.action);
  assert.deepEqual(actions, ['user.disabled', 'user.disabled', 'user.enabled']);
  await expectRejection(() => stack.disable.execute({ userId: '00000000-0000-4000-8000-000000000000', adminId: ADMIN_ID, requestId: 'x' }), 'NOT_FOUND');
});

test('脱敏函数兜底：异常格式不泄露原文', () => {
  assert.equal(maskPhone('13800001234'), '138****1234');
  assert.equal(maskPhone('abc'), '****');
  assert.equal(maskPhone(null), undefined);
});
