import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Group, ShareReservation } = require('../../../backend/dist/contexts/group-buying/domain/index.js');
const { Order } = require('../../../backend/dist/contexts/ordering/domain/index.js');
const { ExpireReservationsTask, FailDeadlineGroupsTask } = require('../../../backend/dist/workflows/order-expiry.tasks.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-01T00:00:00Z');
const LATER = new Date(NOW.getTime() + 3600_000);
const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT = 'cccccccc-3333-4333-8333-333333333333';
const SNAPSHOT = { originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' };

class FakeClock { now() { return NOW; } }
class InlineRunner { async run(work) { return work({ tx: true }); } }

class FakeGroupRepository {
  constructor(groups = []) {
    this.groups = new Map(groups.map((g) => [g.state.groupId, g]));
    this.saved = [];
  }
  async findByIdForUpdate(id) { return this.groups.get(id) ?? null; }
  async findById(id) { return this.groups.get(id) ?? null; }
  async findExpiredOpenGroups(now, limit) {
    return [...this.groups.values()].filter((g) => g.state.status === 'open' && g.state.deadline <= now).slice(0, limit);
  }
  async save(g) { this.groups.set(g.state.groupId, g); this.saved.push(g.state.groupId); }
  async findCandidates() { return { items: [], total: 0 }; }
  async insert() {}
  async listGroups() { return { items: [], total: 0 }; }
  async listByGroup() { return []; }
}

class FakeReservationRepository {
  constructor(reservations = []) {
    this.reservations = new Map(reservations.map((r) => [r.state.orderId, r]));
    this.expiredScan = [];
  }
  async findExpired(now, limit) {
    return [...this.reservations.values()].filter((r) => r.state.status === 'reserved' && r.state.expiresAt <= now).slice(0, limit);
  }
  async findByOrderId(id) { return this.reservations.get(id) ?? null; }
  async save(r) { this.reservations.set(r.state.orderId, r); }
  async insert(r) { this.reservations.set(r.state.orderId, r); }
  async listByGroup(groupId) { return [...this.reservations.values()].filter((r) => r.state.groupId === groupId); }
}

class FakeOrderRepository {
  constructor(orders = []) { this.orders = new Map(orders.map((o) => [o.state.orderId, o])); }
  async findById(id) { return this.orders.get(id) ?? null; }
  async save(o) { this.orders.set(o.state.orderId, o); }
  async insert(o) { this.orders.set(o.state.orderId, o); }
  async findByIdempotencyKey() { return null; }
  async transitionIfUnpaid(orderId, next, now) {
    const o = this.orders.get(orderId);
    if (!o || o.state.status !== 'unpaid') return false;
    this.orders.set(orderId, next === 'cancelled' ? o.cancel(now) : o.markExpired(now));
    return true;
  }
  async listByUser() { return { items: [], total: 0 }; }
  async listAdmin() { return { items: [], total: 0 }; }
}

class FakeStocks {
  constructor() { this.released = []; }
  async releaseOne(productId, key) { this.released.push(key); }
  async reserveOne() {}
  async consumeOne() {}
}

async function expectRejection(factory, code) {
  try { await factory(); }
  catch (error) {
    assert.equal(error.code, code, `${error.code} !== ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`应抛出 ${code}`);
}

function makeGroup(id, overrides = {}) {
  const base = Group.create({ groupId: id, productId: PRODUCT, snapshot: SNAPSHOT, deadline: LATER, now: NOW });
  if (overrides.deadline !== undefined) {
    return Group.rehydrate({ ...base.state, deadline: overrides.deadline });
  }
  return base;
}

function makeReservedState(orderId, units = 20) {
  return ShareReservation.create({ reservationId: `r-${orderId}`, groupId: GROUP1, orderId, units, expiresAt: new Date(NOW.getTime() + 15 * 60_000), now: NOW });
}
const GROUP1 = 'eeeeeeee-5555-4555-8555-555555555555';

function makeOrder(orderId, groupId, units = 20) {
  return Order.create({
    orderId, orderNo: `PO20261001${orderId.slice(-10).replace(/\D/g, '0').padEnd(10, '1')}`.slice(0, 22),
    userId: USER, productId: PRODUCT, groupId, units,
    quote: { totalAmountFen: 16833, goodsAmountFen: 16667, serviceFeeFen: 166, tailAdjustFen: 0, isFinalOrder: false },
    snapshot: { originalPriceFen: 50000, unit: '斤', wholeQuantityText: '10', referenceQuantityText: '3.333' },
    addressSnapshot: { receiverName: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路 88 号 5 栋 201' },
    reservationExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
    now: NOW
  });
}

test('过期任务：到期预占释放（组容量回落 + 订单过期）；未到期不动（G8）', async () => {
  const group = makeGroup(GROUP1).withReservedUnits(20);
  const reservation = makeReservedState('o-1', 20);
  const order = makeOrder('o-1', GROUP1);
  // 预占已到期（expires 15 分钟前，NOW 已前进）
  const expiredReservation = ShareReservation.rehydrate({ ...reservation.state, expiresAt: new Date(NOW.getTime() - 1000) });
  const groups = new FakeGroupRepository([group]);
  const reservations = new FakeReservationRepository([expiredReservation]);
  const orders = new FakeOrderRepository([order]);
  const task = new ExpireReservationsTask({ groups, reservations, orders, runner: new InlineRunner(), clock: new FakeClock() });

  const processed = await task.execute({ limit: 100 });
  assert.equal(processed, 1);
  assert.equal((await reservations.findByOrderId('o-1')).state.status, 'expired');
  assert.equal((await groups.findById(GROUP1)).state.reservedUnits, 0, '组容量回落');
  assert.equal((await orders.findById('o-1')).state.status, 'expired');

  // 未到期：第二轮无到期项
  const second = await task.execute({ limit: 100 });
  assert.equal(second, 0, '重复执行无重复处理（G8 幂等）');
});

test('组截止：组 failed + 库存释放 + 残留预占/订单过期；重复执行幂等（G8/AC-F16-4）', async () => {
  const group = makeGroup(GROUP1, { deadline: new Date(NOW.getTime() - 1000) }).withReservedUnits(20);
  const reservation = ShareReservation.rehydrate({ ...makeReservedState('o-1', 20).state, expiresAt: new Date(NOW.getTime() + 600_000) });
  const order = makeOrder('o-1', GROUP1);
  const groups = new FakeGroupRepository([group]);
  const reservations = new FakeReservationRepository([reservation]);
  const orders = new FakeOrderRepository([order]);
  const stocks = new FakeStocks();
  const task = new FailDeadlineGroupsTask({ groups, reservations, orders, stocks, runner: new InlineRunner(), clock: new FakeClock() });

  const processed = await task.execute({ limit: 100 });
  assert.equal(processed, 1);
  assert.equal((await groups.findById(GROUP1)).state.status, 'failed');
  assert.equal((await groups.findById(GROUP1)).state.reservedUnits, 0);
  assert.equal((await reservations.findByOrderId('o-1')).state.status, 'expired');
  assert.equal((await orders.findById('o-1')).state.status, 'expired');
  assert.deepEqual(stocks.released, [`group-release:${GROUP1}`], '库存整件释放（业务键幂等）');

  // 重复执行：组已 failed，不再处理
  const second = await task.execute({ limit: 100 });
  assert.equal(second, 0);
  assert.equal(stocks.released.length, 1, '库存不重复释放');
});

test('已支付订单不受组截止影响（支付事实保留，退款属支付阶段边界）', async () => {
  const group = makeGroup(GROUP1, { deadline: new Date(NOW.getTime() - 1000) });
  const paidOrder = makeOrder('o-paid', GROUP1).markPaid(NOW);
  const groups = new FakeGroupRepository([group]);
  const reservations = new FakeReservationRepository();
  const orders = new FakeOrderRepository([paidOrder]);
  const task = new FailDeadlineGroupsTask({ groups, reservations, orders, stocks: new FakeStocks(), runner: new InlineRunner(), clock: new FakeClock() });
  await task.execute({ limit: 100 });
  assert.equal((await orders.findById('o-paid')).state.status, 'paid', '已支付订单保持 paid（退款属支付阶段）');
});

test('任务异常不中断循环（记录后继续下一笔）', async () => {
  const g1 = makeGroup('eeeeeeee-5555-4555-8555-555555555558', { deadline: new Date(NOW.getTime() - 2000) });
  const g2 = makeGroup('eeeeeeee-5555-4555-8555-555555555559', { deadline: new Date(NOW.getTime() - 1000) });
  const groups = new FakeGroupRepository([g1, g2]);
  const failingStocks = new FakeStocks();
  let calls = 0;
  failingStocks.releaseOne = async () => { calls++; if (calls === 1) throw new Error('transient db error'); };
  const task = new FailDeadlineGroupsTask({ groups, reservations: new FakeReservationRepository(), orders: new FakeOrderRepository(), stocks: failingStocks, runner: new InlineRunner(), clock: new FakeClock() });
  const processed = await task.execute({ limit: 10 });
  assert.equal(calls, 2, '第一笔失败后仍处理第二笔');
});
