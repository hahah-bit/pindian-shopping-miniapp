import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Address } = require('../../../backend/dist/contexts/identity-access/domain/user/address.js');
const {
  ListMyAddresses,
  CreateAddress,
  UpdateAddress,
  DeleteAddress,
  SetDefaultAddress
} = require('../../../backend/dist/contexts/identity-access/application/user/address-use-cases.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-01T00:00:00Z');
const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-2222-4222-8222-222222222222';

function validInput(overrides = {}) {
  return {
    receiverName: '张三',
    phone: '13800001234',
    province: '广东省',
    city: '深圳市',
    district: '南山区',
    detail: '科技园南路 88 号 5 栋 201',
    ...overrides
  };
}

class InMemoryAddressRepository {
  constructor() { this.addresses = new Map(); this.seq = 0; }
  id() { return `aaaaaaaa-aaaa-4aaa-8aaa-${String(this.seq++).padStart(12, '0')}`; }
  async insert(address) { this.addresses.set(address.state.addressId, address); }
  async findById(addressId, userId) {
    const a = this.addresses.get(addressId);
    return a && a.state.userId === userId ? a : null;
  }
  async listByUser(userId) {
    return [...this.addresses.values()]
      .filter((a) => a.state.userId === userId)
      .sort((a, b) => (b.state.isDefault ? 1 : 0) - (a.state.isDefault ? 1 : 0) || b.state.updatedAt - a.state.updatedAt);
  }
  async countByUser(userId) { return [...this.addresses.values()].filter((a) => a.state.userId === userId).length; }
  async update(address) { this.addresses.set(address.state.addressId, address); }
  async delete(addressId, userId) {
    const a = this.addresses.get(addressId);
    if (!a || a.state.userId !== userId) return false;
    this.addresses.delete(addressId);
    return true;
  }
  async clearDefaultExcept(userId, keepId) {
    for (const [id, a] of this.addresses) {
      if (a.state.userId === userId && id !== keepId && a.state.isDefault) {
        this.addresses.set(id, a.withDefault(false));
      }
    }
  }
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

const clock = { now: () => NOW };

function buildCreate(repo = new InMemoryAddressRepository()) {
  return { repo, create: new CreateAddress({ addresses: repo, clock }) };
}

const usersWithLock = { lockById: async () => {} };
const inlineRunner = { run: async (work) => work({ tx: true }) };

// ---------- 领域校验 ----------

test('地址领域：字段校验矩阵（姓名/手机号/省市区/详情）', () => {
  assert.equal(Address.create({ addressId: 'a1', userId: USER_A, ...validInput(), now: NOW }).state.isDefault, false);
  for (const [label, overrides] of [
    ['姓名空', { receiverName: '  ' }],
    ['姓名超长', { receiverName: 'x'.repeat(21) }],
    ['手机号空', { phone: '' }],
    ['手机号格式', { phone: '23800001234' }],
    ['手机号格式', { phone: '1380001234' }],
    ['省空', { province: '' }],
    ['市空', { city: ' ' }],
    ['区空', { district: '' }],
    ['区超长', { district: 'y'.repeat(21) }],
    ['详情太短', { detail: '短' }],
    ['详情超长', { detail: 'z'.repeat(121) }]
  ]) {
    assert.throws(() => Address.create({ addressId: 'x', userId: USER_A, ...validInput(overrides), now: NOW }), ApplicationError, `应拒绝：${label} ${JSON.stringify(overrides)}`);
  }
});

test('地址领域：迁移方法返回新实例且原聚合不可变', () => {
  const address = Address.create({ addressId: 'a1', userId: USER_A, ...validInput(), now: NOW });
  const moved = address.relocate(validInput({ detail: '新地址 12 号' }), NOW);
  assert.equal(moved.state.detail, '新地址 12 号');
  assert.equal(address.state.detail, '科技园南路 88 号 5 栋 201');
  const defaulted = address.withDefault(true);
  assert.equal(defaulted.state.isDefault, true);
  assert.equal(address.state.isDefault, false);
});

// ---------- 用例 ----------

test('新增：正常创建不自动默认；归属为当前用户', async () => {
  const { repo, create } = buildCreate();
  const view = await create.execute({ userId: USER_A, input: validInput() });
  assert.equal(view.isDefault, false);
  assert.equal(view.receiverName, '张三');
  const stored = await repo.findById(view.id, USER_A);
  assert.ok(stored, '归属当前用户可读');
  assert.equal(await repo.findById(view.id, USER_B), null, '他人不可读');
});

test('新增：校验失败不写入数据（G10）', async () => {
  const { repo, create } = buildCreate();
  await expectRejection(() => create.execute({ userId: USER_A, input: validInput({ phone: '123' }) }), 'VALIDATION_FAILED');
  assert.equal(await repo.countByUser(USER_A), 0);
});

test('上限：20 条满后 409；删除后可再新增（G11）', async () => {
  const { repo, create } = buildCreate();
  for (let i = 0; i < 20; i++) {
    await create.execute({ userId: USER_A, input: validInput({ detail: `地址 ${i} 号楼详细门牌` }) });
  }
  const err = await expectRejection(() => create.execute({ userId: USER_A, input: validInput({ detail: '第 21 条地址详细信息' }) }), 'ADDRESS_LIMIT_REACHED');
  assert.match(err.message, /20/);
  assert.equal(await repo.countByUser(USER_A), 20);
  // 其他用户不受影响
  await create.execute({ userId: USER_B, input: validInput() });
  // 删除一条后可再新增
  const del = new DeleteAddress({ addresses: repo, clock });
  const list = await repo.listByUser(USER_A);
  await del.execute({ userId: USER_A, addressId: list[list.length - 1].state.addressId });
  await create.execute({ userId: USER_A, input: validInput({ detail: '删除后新增的地址信息' }) });
  assert.equal(await repo.countByUser(USER_A), 20);
});

test('归属：B 访问/修改/删除/设默认 A 的地址一律 404（G9）', async () => {
  const { repo, create } = buildCreate();
  const view = await create.execute({ userId: USER_A, input: validInput() });
  const update = new UpdateAddress({ addresses: repo, clock });
  const del = new DeleteAddress({ addresses: repo, clock });
  const setDefault = new SetDefaultAddress({ addresses: repo, users: usersWithLock, runner: inlineRunner });
  await expectRejection(() => update.execute({ userId: USER_B, addressId: view.id, input: validInput({ detail: '篡改后的地址信息' }) }), 'NOT_FOUND');
  await expectRejection(() => del.execute({ userId: USER_B, addressId: view.id }), 'NOT_FOUND');
  await expectRejection(() => setDefault.execute({ userId: USER_B, addressId: view.id }), 'NOT_FOUND');
  const listed = await repo.listByUser(USER_A);
  assert.equal(listed[0].state.detail, '科技园南路 88 号 5 栋 201', '数据未被篡改');
});

test('编辑：全量更新字段', async () => {
  const { repo, create } = buildCreate();
  const view = await create.execute({ userId: USER_A, input: validInput() });
  const update = new UpdateAddress({ addresses: repo, clock });
  const updated = await update.execute({ userId: USER_A, addressId: view.id, input: validInput({ receiverName: '李四', detail: '新 detailed 地址信息' }) });
  assert.equal(updated.receiverName, '李四');
  assert.equal(updated.detail, '新 detailed 地址信息');
});

test('设默认：旧默认被清除；幂等；无默认态合法（首次新增不自动默认）', async () => {
  const { repo, create } = buildCreate();
  const first = await create.execute({ userId: USER_A, input: validInput() });
  const second = await create.execute({ userId: USER_A, input: validInput({ detail: '第二条地址的详细信息' }) });
  const setDefault = new SetDefaultAddress({ addresses: repo, users: usersWithLock, runner: inlineRunner });

  assert.equal((await repo.findById(first.id, USER_A)).state.isDefault, false, '首次新增不自动默认');
  await setDefault.execute({ userId: USER_A, addressId: first.id });
  await setDefault.execute({ userId: USER_A, addressId: second.id });
  assert.equal((await repo.findById(first.id, USER_A)).state.isDefault, false, '旧默认被清除');
  assert.equal((await repo.findById(second.id, USER_A)).state.isDefault, true);
  await setDefault.execute({ userId: USER_A, addressId: second.id }, { alreadyDefault: true });
  assert.equal((await repo.findById(second.id, USER_A)).state.isDefault, true, '幂等');
});

test('删除默认地址：成功且进入无默认态；再次新增不自动默认（G13）', async () => {
  const { repo, create } = buildCreate();
  const first = await create.execute({ userId: USER_A, input: validInput() });
  const second = await create.execute({ userId: USER_A, input: validInput({ detail: '第二条地址的详细信息' }) });
  const setDefault = new SetDefaultAddress({ addresses: repo, users: usersWithLock, runner: inlineRunner });
  const del = new DeleteAddress({ addresses: repo, clock });
  await setDefault.execute({ userId: USER_A, addressId: first.id });
  assert.deepEqual(await del.execute({ userId: USER_A, addressId: first.id }), { deleted: true });
  const remaining = await repo.listByUser(USER_A);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].state.isDefault, false, '删除默认后不自动补默认');
  const third = await create.execute({ userId: USER_A, input: validInput({ detail: '第三条地址的详细信息' }) });
  assert.equal(third.isDefault, false, '无默认态下新增仍不自动默认');
});

test('列表：默认置顶，其余按更新时间倒序', async () => {
  const { repo, create } = buildCreate();
  const a = await create.execute({ userId: USER_A, input: validInput({ detail: '第一条地址的详细信息' }) });
  const b = await create.execute({ userId: USER_A, input: validInput({ detail: '第二条地址的详细信息' }) });
  const setDefault = new SetDefaultAddress({ addresses: repo, users: usersWithLock, runner: inlineRunner });
  await setDefault.execute({ userId: USER_A, addressId: a.id });
  const listed = await new ListMyAddresses({ addresses: repo }).execute({ userId: USER_A });
  assert.equal(listed.items[0].id, a.id, '默认置顶');
  assert.equal(listed.items[1].id, b.id);
  assert.equal(listed.items[0].phone, '13800001234', '本人视图手机号不脱敏');
});
