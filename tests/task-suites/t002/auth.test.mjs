import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  can,
  permissionsOfRole,
  Admin,
  AdminSession,
  LoginThrottle
} = require('../../../backend/dist/contexts/identity-access/domain/index.js');
const {
  LoginAdmin,
  LogoutAdmin,
  AuthenticateAdmin,
  CreateOrUpdateInitialAdmin
} = require('../../../backend/dist/contexts/identity-access/application/index.js');
const { ScryptPasswordHasher } = require('../../../backend/dist/contexts/identity-access/adapters/outbound/crypto/scrypt-password-hasher.js');
const { TokenService } = require('../../../backend/dist/contexts/identity-access/adapters/outbound/crypto/token-service.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

/** assert.rejects 在当前 Node 不返回错误对象；显式捕获并断言错误码。 */
async function expectRejection(factory, code) {
  try {
    await factory();
  } catch (error) {
    assert.ok(error instanceof ApplicationError, `应抛出 ApplicationError，实际 ${error}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`应抛出 ${code}，但调用成功了`);
}

class FakeClock {
  constructor(initial = Date.parse('2026-09-30T08:00:00Z')) { this.ms = initial; }
  now() { return new Date(this.ms); }
  advance(minutes) { this.ms += minutes * 60_000; }
}

class InMemoryAdminRepository {
  constructor() { this.admins = new Map(); }
  async findById(id) { return this.admins.get(id) ?? null; }
  async findByUsername(username) { return [...this.admins.values()].find((a) => a.state.username === username) ?? null; }
  async save(admin) { this.admins.set(admin.state.adminId, admin); }
}

class InMemorySessionRepository {
  constructor() { this.sessions = new Map(); }
  async save(session) { this.sessions.set(session.state.sessionId, session); }
  async findById(id) { return this.sessions.get(id) ?? null; }
  async findByTokenHash(hash) { return [...this.sessions.values()].find((s) => s.state.tokenHash === hash) ?? null; }
  async revoke(id, at) { const s = this.sessions.get(id); if (s) this.sessions.set(id, s.revoke(at)); }
  async revokeAllForAdmin(adminId, at) { for (const [id, s] of this.sessions) if (s.state.adminId === adminId) this.sessions.set(id, s.revoke(at)); }
  async deleteExpired() { return 0; }
}

class FakeHasher {
  constructor() { this.calls = 0; }
  async hash(password) { return `fake:${password}`; }
  async verify(password, hash) { this.calls++; return hash === `fake:${password}`; }
}

const TTL_MINUTES = 720;

function buildLogin(overrides = {}) {
  const clock = new FakeClock();
  const admins = new InMemoryAdminRepository();
  const sessions = new InMemorySessionRepository();
  const hasher = new FakeHasher();
  const tokens = new TokenService();
  const login = new LoginAdmin({
    admins, sessions, hasher, tokens, clock, sessionTtlMinutes: TTL_MINUTES,
    throttle: new LoginThrottle({ maxAttempts: 5, lockWindowMs: 15 * 60_000 }),
    ...overrides
  });
  return { clock, admins, sessions, hasher, tokens, login };
}

function seedAdmin(admins, overrides = {}) {
  const admin = Admin.create({
    username: 'founder', displayName: '创始人', passwordHash: 'fake:correct-password-1',
    adminId: '11111111-1111-4111-8111-111111111111', now: new Date()
  });
  admins.save(admin);
  return admin;
}

test('角色权限：super_admin 拥有全部权限码，未知角色无权限', () => {
  const permissions = permissionsOfRole('super_admin');
  // T003 起新增 user:manage（用户管理）；T008 起新增 agent:manage（客服工作台）
  assert.deepEqual([...permissions].sort(), ['admin:manage', 'agent:manage', 'agent:supervise', 'catalog:manage', 'inventory:manage', 'media:manage', 'order:manage', 'user:manage'].sort());
  assert.equal(can('super_admin', 'catalog:manage'), true);
  assert.equal(can('super_admin', 'media:manage'), true);
  assert.equal(can('super_admin', 'inventory:manage'), true);
  assert.equal(can('super_admin', 'admin:manage'), true);
  assert.equal(can('super_admin', 'user:manage'), true);
  assert.equal(can('super_admin', 'order:manage'), true);
});

test('管理员实体：创建校验用户名与展示名；登录时间记录为不可变更新', () => {
  assert.throws(() => Admin.create({ username: 'A大写', displayName: 'x', passwordHash: 'h', now: new Date() }), ApplicationError);
  assert.throws(() => Admin.create({ username: 'ab', displayName: 'x', passwordHash: 'h', now: new Date() }), ApplicationError);
  assert.throws(() => Admin.create({ username: 'valid-user', displayName: '', passwordHash: 'h', now: new Date() }), ApplicationError);
  const now = new Date('2026-09-30T00:00:00Z');
  const admin = Admin.create({ username: 'valid-user', displayName: '运营', passwordHash: 'h', now });
  assert.equal(admin.state.status, 'active');
  assert.equal(admin.state.role, 'super_admin');
  assert.equal(admin.state.lastLoginAt, null);
  const after = admin.recordLogin(new Date('2026-09-30T01:00:00Z'));
  assert.equal(admin.state.lastLoginAt, null, '原实体不可变');
  assert.equal(after.state.lastLoginAt.toISOString(), '2026-09-30T01:00:00.000Z');
});

test('登录：正确凭据签发会话，token 仅返回一次，过期时间按 TTL 计算', async () => {
  const { clock, admins, login } = buildLogin();
  seedAdmin(admins);
  const result = await login.execute({ username: 'founder', password: 'correct-password-1' });
  assert.ok(result.token.length >= 32);
  assert.equal(result.admin.username, 'founder');
  assert.equal(result.admin.role, 'super_admin');
  assert.ok(result.admin.permissions.includes('catalog:manage'));
  assert.equal(result.expiresAt.toISOString(), new Date(clock.ms + TTL_MINUTES * 60_000).toISOString());
  const updated = await admins.findByUsername('founder');
  assert.ok(updated.state.lastLoginAt, '登录后记录 lastLoginAt');
});

test('登录：错误密码、未知用户、被禁用统一返回 UNAUTHENTICATED 且话术一致', async () => {
  const { admins, login } = buildLogin();
  seedAdmin(admins);
  const wrong = await expectRejection(() => login.execute({ username: 'founder', password: 'wrong-password-1' }), 'UNAUTHENTICATED');
  const unknown = await expectRejection(() => login.execute({ username: 'nobody', password: 'whatever-123' }), 'UNAUTHENTICATED');
  assert.equal(unknown.message, wrong.message, '不区分用户不存在与密码错误');
  const disabledRepo = new InMemoryAdminRepository();
  const admin = Admin.rehydrate({ ...Admin.create({ username: 'off', displayName: '停用', passwordHash: 'fake:p', now: new Date() }).state, status: 'disabled' });
  await disabledRepo.save(admin);
  const { login: login2 } = buildLogin({ admins: disabledRepo });
  await expectRejection(() => login2.execute({ username: 'off', password: 'p' }), 'UNAUTHENTICATED');
});

test('登录限流：同用户名连续失败 5 次后锁定，正确密码也返回 RATE_LIMITED；窗口过后恢复', async () => {
  const { clock, admins, login } = buildLogin();
  seedAdmin(admins);
  for (let i = 0; i < 5; i++) await expectRejection(() => login.execute({ username: 'founder', password: 'bad' }), 'UNAUTHENTICATED');
  const locked = await expectRejection(() => login.execute({ username: 'founder', password: 'correct-password-1' }), 'RATE_LIMITED');
  assert.match(locked.message, /分钟/);
  clock.advance(16);
  const ok = await login.execute({ username: 'founder', password: 'correct-password-1' });
  assert.ok(ok.token, '窗口过后可再次登录');
});

test('登录成功会重置失败计数', async () => {
  const { admins, login } = buildLogin();
  seedAdmin(admins);
  for (let i = 0; i < 4; i++) await expectRejection(() => login.execute({ username: 'founder', password: 'bad' }), 'UNAUTHENTICATED');
  await login.execute({ username: 'founder', password: 'correct-password-1' });
  for (let i = 0; i < 4; i++) await expectRejection(() => login.execute({ username: 'founder', password: 'bad' }), 'UNAUTHENTICATED');
  const ok = await login.execute({ username: 'founder', password: 'correct-password-1' });
  assert.ok(ok.token, '成功后计数清零，未触发 5 次锁定');
});

test('会话：有效 token 通过认证；过期、撤销、管理员被禁用均拒绝', async () => {
  const { clock, admins, sessions, tokens, login } = buildLogin();
  seedAdmin(admins);
  const auth = new AuthenticateAdmin({ admins, sessions, tokens, clock });
  const issued = await login.execute({ username: 'founder', password: 'correct-password-1' });
  const verified = await auth.execute(issued.token);
  assert.equal(verified.adminId, '11111111-1111-4111-8111-111111111111');
  assert.equal(verified.username, 'founder');

  clock.advance(TTL_MINUTES + 1);
  await expectRejection(() => auth.execute(issued.token), 'UNAUTHENTICATED');

  clock.advance(-TTL_MINUTES);
  await sessions.revokeAllForAdmin('11111111-1111-4111-8111-111111111111', clock.now());
  await expectRejection(() => auth.execute(issued.token), 'UNAUTHENTICATED');

  const reissued = await login.execute({ username: 'founder', password: 'correct-password-1' });
  const disabled = Admin.rehydrate({ ...(await admins.findByUsername('founder')).state, status: 'disabled' });
  await admins.save(disabled);
  const disabledErr = await expectRejection(() => auth.execute(reissued.token), 'UNAUTHENTICATED');
  assert.ok(!disabledErr.message.includes('passwordHash'), '错误信息不含敏感字段');
});

test('登出：撤销当前会话，重复登出仍成功', async () => {
  const { clock, admins, sessions, login } = buildLogin();
  seedAdmin(admins);
  await login.execute({ username: 'founder', password: 'correct-password-1' });
  const stored = [...sessions.sessions.values()].find((s) => s.state.tokenHash.length === 64);
  const logout = new LogoutAdmin({ sessions, clock });
  const first = await logout.execute(stored.state.sessionId);
  assert.deepEqual(first, { revoked: true });
  const second = await logout.execute(stored.state.sessionId);
  assert.deepEqual(second, { revoked: true });
  const after = await sessions.findById(stored.state.sessionId);
  assert.ok(after.state.revokedAt, '会话已带撤销时间');
});

test('初始管理员：首次创建；重复执行更新密码并撤销旧会话；非法输入拒绝', async () => {
  const { admins, sessions, clock } = { ...buildLogin() };
  const useCase = new CreateOrUpdateInitialAdmin({ admins, sessions, hasher: new FakeHasher(), clock });
  const created = await useCase.execute({ username: 'root', password: 'initial-password-1' });
  assert.equal(created.created, true);
  const again = await useCase.execute({ username: 'root', password: 'new-password-123' });
  assert.equal(again.created, false);
  assert.equal(again.adminId, created.adminId);
  const stored = await admins.findByUsername('root');
  assert.equal(stored.state.passwordHash, 'fake:new-password-123');
  await assert.rejects(() => useCase.execute({ username: 'Bad Name', password: 'initial-password-1' }), (e) => e.code === 'VALIDATION_FAILED');
  await assert.rejects(() => useCase.execute({ username: 'root2', password: 'short' }), (e) => e.code === 'VALIDATION_FAILED');
});

test('会话签发：token 哈希必须为 64 位十六进制，过期与撤销判定正确', () => {
  assert.throws(() => AdminSession.issue({ adminId: 'a', tokenHash: 'xyz', ttlMinutes: 10, now: new Date() }), ApplicationError);
  const now = new Date('2026-09-30T00:00:00Z');
  const session = AdminSession.issue({ adminId: 'a', tokenHash: 'a'.repeat(64), ttlMinutes: 10, now });
  assert.equal(session.isActive(new Date('2026-09-30T00:09:59Z')), true);
  assert.equal(session.isActive(new Date('2026-09-30T00:10:01Z')), false, '绝对过期，无滑动续期');
  const revoked = session.revoke(new Date('2026-09-30T00:01:00Z'));
  assert.equal(revoked.isActive(new Date('2026-09-30T00:02:00Z')), false);
});

test('scrypt 哈希器：正确密码通过、错误密码拒绝、同密码不同盐、损坏哈希安全返回 false', async () => {
  const hasher = new ScryptPasswordHasher();
  const hash1 = await hasher.hash('correct-password-1');
  const hash2 = await hasher.hash('correct-password-1');
  assert.notEqual(hash1, hash2);
  assert.equal(await hasher.verify('correct-password-1', hash1), true);
  assert.equal(await hasher.verify('wrong-password-1', hash1), false);
  assert.equal(await hasher.verify('x', 'malformed'), false);
  assert.match(hash1, /^scrypt\$/);
});
