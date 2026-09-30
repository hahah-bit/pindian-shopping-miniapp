import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  AdminOrderQueries,
  AdminGroupQueries
} = require('../../../backend/dist/contexts/ordering/application/admin-views.js');
const { Group } = require('../../../backend/dist/contexts/group-buying/domain/index.js');
const { Order } = require('../../../backend/dist/contexts/ordering/domain/index.js');

const NOW = new Date('2026-10-01T00:00:00Z');
const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT = 'cccccccc-3333-4333-8333-333333333333';
const GROUP_1 = 'eeeeeeee-5555-4555-8555-555555555555';
const SNAPSHOT = { originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' };

function makeOrder(id, overrides = {}) {
  return Order.create({
    orderId: id,
    orderNo: `PO20261001${id.slice(-10).replace(/\D/g, '0').padEnd(10, '8')}`.slice(0, 22),
    userId: USER_A, productId: PRODUCT, groupId: GROUP_1, units: 20,
    quote: { totalAmountFen: 16833, goodsAmountFen: 16667, serviceFeeFen: 166, tailAdjustFen: 0, isFinalOrder: false },
    snapshot: { originalPriceFen: 50000, unit: '斤', wholeQuantityText: '10', referenceQuantityText: '3.333' },
    addressSnapshot: { receiverName: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路 88 号 5 栋 201' },
    reservationExpiresAt: new Date(NOW.getTime() + 900_000),
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    now: NOW
  });
}

class FakeOrderRepository {
  constructor(orders = []) { this.orders = new Map(orders.map((o) => [o.state.orderId, o])); }
  async listAdmin(query) {
    let items = [...this.orders.values()];
    if (query.status) items = items.filter((o) => o.state.status === query.status);
    if (query.keyword) items = items.filter((o) => o.state.orderNo.includes(query.keyword) || o.state.addressReceiverName.includes(query.keyword));
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: items.length };
  }
  async findById(id) { return this.orders.get(id) ?? null; }
  async findNickname(userId) { return '拼单小明'; }
}

class FakeGroupRepository {
  constructor(groups = []) { this.groups = new Map(groups.map((g) => [g.state.groupId, g])); this.reservations = new Map(); }
  async listGroups(query) {
    let items = [...this.groups.values()];
    if (query.status) items = items.filter((g) => g.state.status === query.status);
    return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: items.length };
  }
  async findById(id) { return this.groups.get(id) ?? null; }
  async listByGroup(groupId) { return [...this.reservations.values()].filter((r) => r.state.groupId === groupId); }
}

test('后台订单列表：状态筛选、关键字（订单号/收货人）、分页', async () => {
  const orders = new FakeOrderRepository([makeOrder('o-1'), makeOrder('o-2').markPaid(NOW)]);
  const queries = new AdminOrderQueries({ orders: orders, nicknameOf: async () => '拼单小明' });
  const all = await queries.list({ page: 1, pageSize: 10 });
  assert.equal(all.total, 2);
  const paid = await queries.list({ status: 'paid', page: 1, pageSize: 10 });
  assert.equal(paid.total, 1);
  const keyword = await queries.list({ keyword: 'PO', page: 1, pageSize: 10 });
  assert.equal(keyword.total, 2);
  const page1 = await queries.list({ page: 1, pageSize: 1 });
  assert.equal(page1.items.length, 1);
});

test('后台订单/组视图不暴露地址与手机号（G 脱敏）', async () => {
  const orders = new FakeOrderRepository([makeOrder('o-1')]);
  const queries = new AdminOrderQueries({ orders: orders, nicknameOf: async () => '拼单小明' });
  const list = await queries.list({ page: 1, pageSize: 10 });
  assert.ok(!JSON.stringify(list).includes('13800001234'), '列表无手机号');
  assert.ok(!JSON.stringify(list).includes('科技园南路'), '列表无地址');
  const detail = await queries.get('o-1');
  assert.ok(!JSON.stringify(detail).includes('13800001234'), '详情默认无手机号');
  assert.ok(!JSON.stringify(detail).includes('科技园南路'), '详情无地址详情');
  assert.equal(detail.quote.totalAmountFen, 16833);
  assert.ok(detail.nickname, '昵称可展示');
});

test('后台组详情：成员摘要只有订单号/昵称/单位/状态，无手机号地址', async () => {
  const order = makeOrder('o-1');
  const group = Group.create({ groupId: GROUP_1, productId: PRODUCT, snapshot: SNAPSHOT, deadline: new Date(NOW.getTime() + 3600_000), now: NOW }).withReservedUnits(20);
  const groups = new FakeGroupRepository([group]);
  groups.reservations.set('o-1', { state: { groupId: GROUP_1, orderId: 'o-1', units: 20, status: 'reserved' } });
  const orders2 = new FakeOrderRepository([order]);
  const queries = new AdminGroupQueries({ groups: groups, reservations: groups, orders: orders2, nicknameOf: async () => '拼单小明' });
  const view = await queries.get(GROUP_1);
  assert.equal(view.remainingCapacity, 40);
  assert.equal(view.members.length, 1);
  assert.deepEqual(Object.keys(view.members[0]).sort(), ['nickname', 'orderNo', 'status', 'units']);
  assert.ok(!JSON.stringify(view).includes('13800001234'));
  assert.ok(!JSON.stringify(view).includes('科技园南路'));
});

test('组/订单详情不存在返回 NOT_FOUND', async () => {
  const queries = new AdminOrderQueries({ orders: new FakeOrderRepository(), nicknameOf: async () => '' });
  await assert.rejects(() => queries.get('missing'), (e) => e.code === 'NOT_FOUND');
  const groupQueries = new AdminGroupQueries({ groups: new FakeGroupRepository(), orders: new FakeOrderRepository(), nicknameOf: async () => '' });
  await assert.rejects(() => groupQueries.get(GROUP_1), (e) => e.code === 'NOT_FOUND');
});
