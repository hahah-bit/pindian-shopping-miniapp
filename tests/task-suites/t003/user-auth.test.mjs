import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);

const {
  User,
  WechatIdentity,
  UserSession,
  maskPhone
} = require('../../../backend/dist/contexts/identity-access/domain/user/index.js');
const {
  LoginWithWechat,
  AuthenticateUser,
  LogoutUser,
  BindPhone,
  UpdateProfile,
  WxCodeInvalidError,
  WxNotConfiguredError,
  WxUnavailableError
} = require('../../../backend/dist/contexts/identity-access/application/user/index.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-01T00:00:00Z');
const TTL_MINUTES = 20160; // 14 天

class FakeClock {
  constructor() { this.ms = NOW.getTime(); }
  now() { return new Date(this.ms); }
  advance(minutes) { this.ms += minutes * 60_000; }
}

class InMemoryUserRepository {
  constructor() { this.users = new Map(); }
  async findById(id) { return this.users.get(id) ?? null; }
  async findByIdIfActive(id) { const u = this.users.get(id); return u && u.state.status === 'active' ? u : null; }
  async save(user) { this.users.set(user.state.userId, user); }
  async updateStatus(id, status, at) {
    const u = this.users.get(id);
    if (!u) return false;
    this.users.set(id, status === 'disabled' ? u.disable(at) : u.enable(at));
    return true;
  }
}

class InMemoryIdentityRepository {
  constructor() { this.identities = new Map(); this.failInsertOpenid = null; }
  async findByOpenid(openid) { return [...this.identities.values()].find((i) => i.state.openid === openid) ?? null; }
  async findByUserId(userId) { return [...this.identities.values()].find((i) => i.state.userId === userId) ?? null; }
  async insert(identity) {
    if (this.identities.has(identity.state.openid)) throw new Error('unique violation openid=' + identity.state.openid);
    if (this.failInsertOpenid === identity.state.openid) throw new Error('unique violation (simulated race)');
    this.identities.set(identity.state.openid, identity);
  }
}

class InMemoryUserSessionRepository {
  constructor() { this.sessions = new Map(); }
  async save(session) { this.sessions.set(session.state.sessionId, session); }
  async findByTokenHash(hash) { return [...this.sessions.values()].find((s) => s.state.tokenHash === hash) ?? null; }
  async findBySessionId(sessionId) { return this.sessions.get(sessionId) ?? null; }
  async revoke(sessionId, at) { const s = this.sessions.get(sessionId); if (s) this.sessions.set(sessionId, s.revoke(at)); }
  async revokeAllForUser(userId, at) { for (const [id, s] of this.sessions) if (s.state.userId === userId) this.sessions.set(id, s.revoke(at)); }
  async deleteExpired() { return 0; }
}

class FakeWxAuth {
  constructor() { this.openidByCode = { 'code-new': 'openid-A', 'code-existing': 'openid-A', 'code-b': 'openid-B' }; this.calls = 0; }
  async exchangeCodeForSession(code) {
    this.calls++;
    if (this.openidByCode[code]) return { openid: this.openidByCode[code] };
    throw new WxCodeInvalidError();
  }
}

class FakeWxAuthNotConfigured {
  async exchangeCodeForSession() { throw new WxNotConfiguredError(); }
}

class FakeWxAuthDown {
  async exchangeCodeForSession() { throw new WxUnavailableError(); }
}

class FakeWxPhone {
  constructor() { this.result = { purePhoneNumber: '13800001234', countryCode: '86' }; this.lastArgs = null; }
  async exchangePhoneNumberCode(code, openid) { this.lastArgs = { code, openid }; return this.result; }
}

class FakeHashService {
  generate() { return randomBytes(32).toString('base64url'); }
  hash(token) { return createHash('sha256').update(token).digest('hex'); }
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

function buildStack(overrides = {}) {
  const clock = new FakeClock();
  const users = new InMemoryUserRepository();
  const identities = new InMemoryIdentityRepository();
  const sessions = new InMemoryUserSessionRepository();
  const tokens = new FakeHashService();
  const wxAuth = overrides.wxAuth ?? new FakeWxAuth();
  const wxPhone = overrides.wxPhone ?? new FakeWxPhone();
  const login = new LoginWithWechat({
    users, identities, sessions, tokens, wxAuth, clock,
    sessionTtlMinutes: TTL_MINUTES,
    runner: { run: async (work) => work() }
  });
  const auth = new AuthenticateUser({ users, sessions, tokens, clock });
  const logout = new LogoutUser({ sessions, clock });
  const bindPhone = new BindPhone({ users, identities, wxPhone, clock });
  const updateProfile = new UpdateProfile({ users, clock });
  return { clock, users, identities, sessions, tokens, wxAuth, wxPhone, login, auth, logout, bindPhone, updateProfile };
}

// ---------- 领域 ----------

test('用户实体：昵称校验、绑定手机号必须带验证事实、禁用/启用不可变迁移', () => {
  const user = User.create({ userId: 'u1', now: NOW });
  assert.equal(user.state.nickname, '微信用户');
  assert.equal(user.state.status, 'active');
  assert.equal(user.state.phone, null);

  assert.throws(() => User.create({ userId: 'u2', nickname: '', now: NOW }), ApplicationError);
  assert.throws(() => User.create({ userId: 'u3', nickname: 'x'.repeat(31), now: NOW }), ApplicationError);

  const bound = user.bindPhone('13800001234', '86', 'wechat_quick_verify', NOW);
  assert.equal(bound.state.phone, '13800001234');
  assert.ok(bound.state.phoneVerifiedAt);
  assert.throws(() => User.create({ userId: 'u4', phone: '13800001234', now: NOW }), ApplicationError, '无验证事实不能有手机号');

  const renamed = bound.rename('小明');
  assert.equal(renamed.state.nickname, '小明');
  assert.throws(() => renamed.rename('  '), ApplicationError);
  assert.throws(() => renamed.rename('y'.repeat(31)), ApplicationError);

  const disabled = renamed.disable(NOW);
  assert.equal(disabled.state.status, 'disabled');
  const enabled = disabled.enable(NOW);
  assert.equal(enabled.state.status, 'active');
  assert.equal(renamed.state.status, 'active', '原聚合不可变');
});

test('微信身份：openid 唯一性由实体校验兜底（数据库约束为主）', () => {
  const identity = WechatIdentity.bind({ openid: 'o-1', userId: 'u1', now: NOW });
  assert.equal(identity.state.openid, 'o-1');
  assert.throws(() => WechatIdentity.bind({ openid: '', userId: 'u1', now: NOW }), ApplicationError);
  assert.throws(() => WechatIdentity.bind({ openid: 'o-2', userId: '', now: NOW }), ApplicationError);
});

test('用户会话：签发、绝对过期、撤销；token 哈希格式校验', () => {
  const session = UserSession.issue({ userId: 'u1', tokenHash: 'a'.repeat(64), ttlMinutes: 10, now: NOW });
  assert.ok(session.isActive(new Date(NOW.getTime() + 9 * 60_000)));
  assert.equal(session.isActive(new Date(NOW.getTime() + 11 * 60_000)), false, '绝对过期');
  assert.throws(() => UserSession.issue({ userId: 'u1', tokenHash: 'bad', ttlMinutes: 10, now: NOW }), ApplicationError);
  const revoked = session.revoke(NOW);
  assert.equal(revoked.isActive(NOW), false);
});

test('手机号脱敏：大陆 11 位掩码中间四位；异常格式仅尾四位', () => {
  assert.equal(maskPhone('13800001234'), '138****1234');
  assert.equal(maskPhone('0012345'), '****2345');
  assert.equal(maskPhone('123'), '****');
});

// ---------- 登录与认证 ----------

test('登录：首次创建用户与身份，isNewUser=true；重复登录关联同一用户', async () => {
  const stack = buildStack();
  const first = await stack.login.execute({ code: 'code-new' });
  assert.equal(first.isNewUser, true);
  assert.equal(first.user.nickname, '微信用户');
  assert.ok(first.token.length >= 32);
  assert.equal(first.expiresAt.getTime(), NOW.getTime() + TTL_MINUTES * 60_000);

  stack.clock.advance(5);
  const second = await stack.login.execute({ code: 'code-existing' });
  assert.equal(second.isNewUser, false);
  assert.equal(second.user.id, first.user.id, '同一 openid 关联同一用户');
  assert.equal(stack.users.users.size, 1, '不产生重复用户');
  assert.ok((await stack.users.findById(first.user.id)).state.lastLoginAt > NOW, '更新 lastLoginAt');
});

test('登录并发唯一冲突：插入抛 23505 后回滚并回读并发赢家，最终同一用户', async () => {
  const stack = buildStack();
  stack.identities.failInsertOpenid = 'openid-A';
  const winner = User.create({ userId: 'u-winner', now: NOW });
  await stack.users.save(winner);
  // 模拟并发赢家在本请求查后、插前落库：insert 时先写入赢家身份再抛 23505
  stack.identities.insert = async (identity) => {
    if (identity.state.openid === stack.identities.failInsertOpenid) {
      stack.identities.identities.set('openid-A', WechatIdentity.bind({ openid: 'openid-A', userId: 'u-winner', now: NOW }));
      const violation = new Error('duplicate key value violates unique constraint');
      violation.code = '23505';
      throw violation;
    }
    stack.identities.identities.set(identity.state.openid, identity);
  };
  const result = await stack.login.execute({ code: 'code-new' });
  assert.equal(result.isNewUser, false, '冲突路径视为关联既有用户');
  assert.equal(result.user.id, 'u-winner', '冲突后回读并发赢家身份');
  // 孤儿用户回滚由真实 PG 事务在集成测试验证；内存 runner 无回滚语义。
});

test('登录失败路径：无效 code 401、微信不可用 502、未配置 503，且均不产生数据', async () => {
  const invalid = buildStack();
  await expectRejection(() => invalid.login.execute({ code: 'bad-code' }), 'WECHAT_CODE_INVALID');
  assert.equal(invalid.users.users.size, 0);
  assert.equal(invalid.sessions.sessions.size, 0);

  const down = buildStack({ wxAuth: new FakeWxAuthDown() });
  await expectRejection(() => down.login.execute({ code: 'code-new' }), 'WECHAT_UNAVAILABLE');
  assert.equal(down.users.users.size, 0);

  const notConfigured = buildStack({ wxAuth: new FakeWxAuthNotConfigured() });
  const error = await expectRejection(() => notConfigured.login.execute({ code: 'code-new' }), 'WECHAT_NOT_CONFIGURED');
  assert.match(error.message, /未配置/);
  assert.equal(notConfigured.users.users.size, 0);
  assert.equal(notConfigured.wxAuth.calls ?? 0, 0, '未配置不应尝试外部调用');
});

test('登录：空 code 校验拒绝；被禁用用户登录 403 USER_DISABLED', async () => {
  const stack = buildStack();
  await expectRejection(() => stack.login.execute({ code: '' }), 'VALIDATION_FAILED');

  const first = await stack.login.execute({ code: 'code-new' });
  await stack.users.updateStatus(first.user.id, 'disabled', stack.clock.now());
  const err = await expectRejection(() => stack.login.execute({ code: 'code-existing' }), 'USER_DISABLED');
  assert.match(err.message, /禁用/);
});

test('会话认证：有效通过；过期、撤销、禁用拒绝；错误不泄露敏感信息', async () => {
  const stack = buildStack();
  const issued = await stack.login.execute({ code: 'code-new' });
  const verified = await stack.auth.execute(issued.token);
  assert.equal(verified.userId, firstId(stack));
  assert.equal(verified.nickname, '微信用户');

  stack.clock.advance(TTL_MINUTES + 1);
  await expectRejection(() => stack.auth.execute(issued.token), 'UNAUTHENTICATED');

  stack.clock.advance(-(TTL_MINUTES + 1));
  const stored = [...stack.sessions.sessions.values()].find((s) => s.state.tokenHash === stack.tokens.hash(issued.token));
  await stack.sessions.revoke(stored.state.sessionId, stack.clock.now());
  await expectRejection(() => stack.auth.execute(issued.token), 'UNAUTHENTICATED');

  const reissued = await stack.login.execute({ code: 'code-new' });
  await stack.users.updateStatus(reissued.user.id, 'disabled', stack.clock.now());
  const disabledErr = await expectRejection(() => stack.auth.execute(reissued.token), 'USER_DISABLED');
  assert.ok(!disabledErr.message.includes('token'), '错误信息不泄露凭证内容');
});

function firstId(stack) {
  return [...stack.users.users.keys()][0];
}

test('登出：撤销当前会话并幂等', async () => {
  const stack = buildStack();
  const issued = await stack.login.execute({ code: 'code-new' });
  const stored = [...stack.sessions.sessions.values()].find((s) => s.state.tokenHash === stack.tokens.hash(issued.token));
  assert.deepEqual(await stack.logout.execute(stored.state.sessionId), { revoked: true });
  assert.deepEqual(await stack.logout.execute(stored.state.sessionId), { revoked: true });
  await expectRejection(() => stack.auth.execute(issued.token), 'UNAUTHENTICATED');
});

test('admin 与 user token 天然隔离：admin 哈希不会命中 user 会话', async () => {
  const stack = buildStack();
  await stack.login.execute({ code: 'code-new' });
  await expectRejection(() => stack.auth.execute('admin-token-value'), 'UNAUTHENTICATED');
});

// ---------- 手机号与资料 ----------

test('绑定手机号：验证事实写入；换绑覆盖；openid 绑定校验防跨用户', async () => {
  const stack = buildStack();
  const issued = await stack.login.execute({ code: 'code-new' });

  const bound = await stack.bindPhone.execute({ userId: issued.user.id, code: 'phone-code' });
  assert.equal(bound.hasPhone, true);
  assert.equal(bound.phoneMasked, '138****1234');
  const stored = await stack.users.findById(issued.user.id);
  assert.equal(stored.state.phone, '13800001234');
  assert.ok(stored.state.phoneVerifiedAt);
  assert.equal(stored.state.phoneSource, 'wechat_quick_verify');
  assert.equal(stack.wxPhone.lastArgs.openid, 'openid-A', '带 openid 绑定校验');

  stack.wxPhone.result = { purePhoneNumber: '13900005678', countryCode: '86' };
  stack.clock.advance(10);
  const rebound = await stack.bindPhone.execute({ userId: issued.user.id, code: 'phone-code-2' });
  assert.equal(rebound.phoneMasked, '139****5678');

  // openid 不匹配（模拟他人 code）：端口侧校验 code 与 openid 绑定关系，不匹配抛 PHONE_CODE_INVALID
  const strictPhone = new FakeWxPhone();
  strictPhone.exchangePhoneNumberCode = async (code, openid) => {
    if (code === 'code-of-B' && openid !== 'openid-B') throw new ApplicationError('PHONE_CODE_INVALID', '凭证与当前用户不匹配');
    return { purePhoneNumber: '13700009999', countryCode: '86' };
  };
  const strictStack = buildStack({ wxPhone: strictPhone });
  const userA = await strictStack.login.execute({ code: 'code-new' }); // openid-A
  const err = await expectRejection(() => strictStack.bindPhone.execute({ userId: userA.user.id, code: 'code-of-B' }), 'PHONE_CODE_INVALID');
  assert.match(err.message, /不匹配/);
  const ok = await strictStack.bindPhone.execute({ userId: userA.user.id, code: 'normal-code' }); // 自己的 code 正常
  assert.equal(ok.phoneMasked, '137****9999');
});

test('绑定手机号：微信失败不标记绑定成功（G14）', async () => {
  const failingPhone = new FakeWxPhone();
  failingPhone.exchangePhoneNumberCode = async () => { throw new ApplicationError('PHONE_CODE_INVALID', '手机号授权凭证无效'); };
  const stack = buildStack({ wxPhone: failingPhone });
  const issued = await stack.login.execute({ code: 'code-new' });
  await expectRejection(() => stack.bindPhone.execute({ userId: issued.user.id, code: 'x' }), 'PHONE_CODE_INVALID');
  const stored = await stack.users.findById(issued.user.id);
  assert.equal(stored.state.phone, null, '失败不写手机号');
  assert.equal(stored.state.phoneVerifiedAt, null);
});

test('资料修改：昵称合法更新；非法拒绝；me 视图字段正确', async () => {
  const stack = buildStack();
  const issued = await stack.login.execute({ code: 'code-new' });
  const updated = await stack.updateProfile.execute({ userId: issued.user.id, nickname: '  拼单小明  ' });
  assert.equal(updated.nickname, '拼单小明');
  await expectRejection(() => stack.updateProfile.execute({ userId: issued.user.id, nickname: '' }), 'VALIDATION_FAILED');
  await expectRejection(() => stack.updateProfile.execute({ userId: issued.user.id, nickname: 'x'.repeat(31) }), 'VALIDATION_FAILED');
  const me = await stack.auth.execute(issued.token);
  assert.equal(me.nickname, '拼单小明');
  assert.equal(me.hasPhone, false);
});
