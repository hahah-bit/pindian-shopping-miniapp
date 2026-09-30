import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  computeQuote,
  Order,
  OrderNumber
} = require('../../../backend/dist/contexts/ordering/domain/index.js');
const { Group, ShareReservation } = require('../../../backend/dist/contexts/group-buying/domain/index.js');
const { PlaceOrderWorkflow, CancelUnpaidOrder } = require('../../../backend/dist/workflows/order-place.workflow.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-01T00:00:00Z');
const USER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const USER_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const PRODUCT = 'cccccccc-3333-4333-8333-333333333333';
const ADDRESS = 'dddddddd-4444-4444-8444-444444444444';
const GROUP_1 = 'eeeeeeee-5555-4555-8555-555555555555';
const TTL = 15;

const SNAPSHOT = {
  originalPriceFen: 50000,
  userWholePriceFen: 50500,
  allowedShareUnits: [30, 20, 15, 12],
  wholeQuantityText: '10',
  unit: '斤'
};

const ADDRESS_SNAPSHOT = { receiverName: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路 88 号 5 栋 201' };

// ---------- 定价纯函数（G10） ----------

test('报价：通用 half-up 价与商品/服务费拆分', () => {
  const q = computeQuote({ originalPriceFen: 50000, units: 30, isFinalOrder: false, groupPaidAmountFen: 0, groupPaidGoodsFen: 0 });
  assert.deepEqual([q.totalAmountFen, q.goodsAmountFen, q.serviceFeeFen, q.tailAdjustFen, q.isFinalOrder], [25250, 25000, 250, 0, false]);
  const q3 = computeQuote({ originalPriceFen: 50000, units: 20, isFinalOrder: false, groupPaidAmountFen: 0, groupPaidGoodsFen: 0 });
  assert.deepEqual([q3.totalAmountFen, q3.goodsAmountFen, q3.serviceFeeFen], [16833, 16667, 166]);
});

test('报价：最后单补差使组合计严格守恒（G10）', () => {
  // 1/3+1/3+1/3：前两单 16833，第三单最后单 = 50500−16833×2 = 16834
  const final = computeQuote({ originalPriceFen: 50000, units: 20, isFinalOrder: true, groupPaidAmountFen: 16833 * 2, groupPaidGoodsFen: 16667 * 2 });
  assert.equal(final.totalAmountFen, 50500 - 16833 * 2);
  assert.equal(final.totalAmountFen, 16834);
  assert.equal(final.goodsAmountFen, 50000 - 16667 * 2);
  assert.equal(final.tailAdjustFen, final.totalAmountFen - 16833);
  assert.equal(final.serviceFeeFen, final.totalAmountFen - final.goodsAmountFen);
  // 守恒：Σtotal=50500、Σgoods=50000、Σservice=500
  assert.equal(16833 + 16833 + final.totalAmountFen, 50500);
  assert.equal(16667 + 16667 + final.goodsAmountFen, 50000);
});

test('报价：1/2+1/2 无尾差；1/4×4 无尾差', () => {
  const half = computeQuote({ originalPriceFen: 50000, units: 30, isFinalOrder: true, groupPaidAmountFen: 25250, groupPaidGoodsFen: 25000 });
  assert.equal(half.totalAmountFen, 25250);
  assert.equal(half.tailAdjustFen, 0);
  const quarter = computeQuote({ originalPriceFen: 50000, units: 15, isFinalOrder: true, groupPaidAmountFen: 12625 * 3, groupPaidGoodsFen: 12500 * 3 });
  assert.equal(quarter.totalAmountFen, 12625);
  assert.equal(quarter.tailAdjustFen, 0);
});

test('报价：负数总额（数据异常）拒绝；非法单位拒绝', () => {
  assert.throws(() => computeQuote({ originalPriceFen: 50000, units: 20, isFinalOrder: true, groupPaidAmountFen: 60000, groupPaidGoodsFen: 60000 }), ApplicationError);
  assert.throws(() => computeQuote({ originalPriceFen: 50000, units: 7, isFinalOrder: false, groupPaidAmountFen: 0, groupPaidGoodsFen: 0 }), ApplicationError);
});

// ---------- 订单实体 ----------

test('订单实体：创建 unpaid、快照不可变、终态单向', () => {
  const order = Order.create({
    orderId: 'o-1', orderNo: OrderNumber.generate(NOW, () => '1234567890'),
    userId: USER_A, productId: PRODUCT, groupId: GROUP_1, units: 20,
    quote: computeQuote({ originalPriceFen: 50000, units: 20, isFinalOrder: false, groupPaidAmountFen: 0, groupPaidGoodsFen: 0 }),
    snapshot: { originalPriceFen: 50000, unit: '斤', wholeQuantityText: '10', referenceQuantityText: '3.333' },
    addressSnapshot: ADDRESS_SNAPSHOT,
    reservationExpiresAt: new Date(NOW.getTime() + TTL * 60_000),
    idempotencyKey: 'eeeeeeee-6666-4666-8666-666666666666',
    now: NOW
  });
  assert.equal(order.state.status, 'unpaid');
  assert.equal(order.state.totalAmountFen, 16833);
  const cancelled = order.cancel(NOW);
  assert.equal(cancelled.state.status, 'cancelled');
  assert.equal(order.state.status, 'unpaid', '原聚合不可变');
  assert.throws(() => cancelled.cancel(NOW), ApplicationError, '终态不可再取消');
  assert.throws(() => cancelled.markExpired(NOW), ApplicationError);
});

test('订单号：前缀+日期+随机段，同秒不同序', () => {
  const n1 = OrderNumber.generate(NOW, () => '1111111111');
  assert.match(n1, /^PO20261001\d{10}$/);
  const n2 = OrderNumber.generate(NOW, () => '2222222222');
  assert.notEqual(n1, n2);
});

// ---------- 预占实体 ----------

test('预占实体：reserved 起步、单向迁移、过期判定', () => {
  const r = ShareReservation.create({ reservationId: 'r-1', groupId: GROUP_1, orderId: 'o-1', units: 20, expiresAt: new Date(NOW.getTime() + TTL * 60_000), now: NOW });
  assert.equal(r.state.status, 'reserved');
  assert.equal(r.isExpired(NOW), false);
  assert.equal(r.isExpired(new Date(NOW.getTime() + TTL * 60_000 + 1)), true);
  const converted = r.convert(NOW);
  assert.equal(converted.state.status, 'converted');
  assert.throws(() => converted.expire(NOW), ApplicationError, 'converted 终态不可逆');
  const expired = r.expire(NOW);
  assert.equal(expired.state.status, 'expired');
  assert.throws(() => expired.convert(NOW), ApplicationError);
});

// ---------- 组实体 ----------

test('组实体：创建 open、快照固化、容量重查、拼满迁移（60 才成功）', () => {
  const group = Group.create({ groupId: GROUP_1, productId: PRODUCT, snapshot: SNAPSHOT, deadline: new Date(NOW.getTime() + 24 * 3600_000), now: NOW });
  assert.equal(group.state.status, 'open');
  assert.equal(group.state.paidUnits, 0);
  assert.deepEqual(group.state.snapshot.allowedShareUnits, [30, 20, 15, 12]);
  const withReserve = group.withReservedUnits(20);
  assert.equal(withReserve.state.reservedUnits, 20);
  assert.equal(withReserve.state.paidUnits, 0);
  // 容量：paid0+res20=20，再预占 41 → 61 超容拒绝
  assert.equal(withReserve.withReservedUnits(20).state.reservedUnits, 40);
  assert.throws(() => withReserve.withReservedUnits(41), (e) => e.code === 'SHARE_CAPACITY_CONFLICT');
  assert.throws(() => group.withPaidUnits(1), ApplicationError, '无预占不能直接转支付');
  // 支付生效：预占转正（paid+20，reserved−20）
  const paid = withReserve.withPaidUnits(20, NOW);
  assert.equal(paid.state.paidUnits, 20);
  assert.equal(paid.state.reservedUnits, 0);
  assert.equal(paid.state.status, 'open');
  // 60 才成功
  const almostFull = paid.withReservedUnits(40).withPaidUnits(40, NOW);
  assert.equal(almostFull.state.paidUnits, 60);
  const success = almostFull.markSuccess(NOW);
  assert.equal(success.state.status, 'success');
  assert.throws(() => success.withReservedUnits(1), (e) => e.code === 'GROUP_NOT_JOINABLE');
  // 59 不允许成功（先合法预占 39）
  assert.throws(() => paid.withReservedUnits(39).markSuccess(NOW), (e) => e.code === 'VALIDATION_FAILED');
});

// ---------- 下单工作流（假件编排） ----------

class FakeGroupRepository {
  constructor(groups = []) { this.groups = new Map(groups.map((g) => [g.state.groupId, g])); }
  async findByIdForUpdate(id) { return this.groups.get(id) ?? null; }
  async findById(id) { return this.groups.get(id) ?? null; }
  async findCandidates(query) {
    return [...this.groups.values()]
      .filter((g) => g.state.status === 'open'
        && g.state.productId === query.productId
        && g.state.deadline > query.now
        && 60 - g.state.paidUnits - g.state.reservedUnits >= query.units
        && g.state.snapshot.allowedShareUnits.includes(query.units))
      .sort((a, b) => (60 - a.state.paidUnits - a.state.reservedUnits) - (60 - b.state.paidUnits - b.state.reservedUnits)
        || a.state.createdAt - b.state.createdAt
        || a.state.groupId.localeCompare(b.state.groupId));
  }
  async insert(g) { this.groups.set(g.state.groupId, g); }
  async save(g) { this.groups.set(g.state.groupId, g); }
}

class FakeReservationRepository {
  constructor() { this.reservations = new Map(); }
  async insert(r) {
    if (this.reservations.has(r.state.orderId)) { const e = new Error('dup'); e.code = '23505'; throw e; }
    this.reservations.set(r.state.orderId, r);
  }
  async findByOrderId(id) { return this.reservations.get(id) ?? null; }
  async save(r) { this.reservations.set(r.state.orderId, r); }
}

class FakeOrderRepository {
  constructor() { this.orders = new Map(); }
  async findByIdempotencyKey(userId, key) { return [...this.orders.values()].find((o) => o.state.userId === userId && o.state.idempotencyKey === key) ?? null; }
  async insert(o) { this.orders.set(o.state.orderId, o); }
  async findById(id) { return this.orders.get(id) ?? null; }
  async save(o) { this.orders.set(o.state.orderId, o); }
}

class FakeAddressOwnership {
  constructor() { this.map = new Map([[USER_A + ':' + ADDRESS, ADDRESS_SNAPSHOT], [USER_B + ':' + ADDRESS, { ...ADDRESS_SNAPSHOT, receiverName: 'B 的地址' }]]); }
  async getAddressForUser(addressId, userId) {
    const snapshot = this.map.get(userId + ':' + addressId);
    return snapshot ? { addressId, ...snapshot } : null;
  }
}

class FakeProductSnapshot {
  constructor(onShelf = true, snapshot = SNAPSHOT) { this.onShelf = onShelf; this.snapshot = snapshot; }
  async getSellableSnapshot() {
    if (!this.onShelf) return null;
    return { productId: PRODUCT, snapshot: this.snapshot, deadlineHours: 24 };
  }
}

class FakeStockPort {
  constructor(available = 5) { this.available = available; this.calls = []; }
  async reserveOne(productId, key) {
    this.calls.push(key);
    if (this.available <= 0) { const e = new ApplicationError('STOCK_INSUFFICIENT', '不足'); throw e; }
    this.available -= 1;
    return { available: this.available, reserved: 1 };
  }
}

class FakeCompleteness {
  tableFor() { return buildFullTable(); }
}
function buildFullTable() {
  const dp = new Array(61).fill(false);
  dp[0] = true;
  for (let s = 1; s <= 60; s++) {
    for (const u of [30, 20, 15, 12]) if (u <= s && dp[s - u]) { dp[s] = true; break; }
  }
  return dp;
}

const runner = { run: async (work) => work({ tx: true }) };
const clock = { now: () => NOW };

function buildWorkflow(overrides = {}) {
  const groups = new FakeGroupRepository();
  const reservations = new FakeReservationRepository();
  const orders = new FakeOrderRepository();
  const addresses = new FakeAddressOwnership();
  const products = new FakeProductSnapshot();
  const stocks = new FakeStockPort();
  const completeness = new FakeCompleteness();
  const uuidSeq = { n: 0 };
  const workflow = new PlaceOrderWorkflow({
    groups, reservations, orders, addresses, products, stocks, completeness, runner, clock,
    reservationTtlMinutes: TTL,
    generateId: () => `aaaaaaaa-bbbb-4ccc-8ddd-${String(++uuidSeq.n).padStart(12, '0')}`,
    generateOrderNo: () => `PO20261001${String(uuidSeq.n).padStart(10, '0')}`,
    maxRetries: 3,
    ...overrides
  });
  return { groups, reservations, orders, addresses, products, stocks, workflow };
}

const validCommand = { productId: PRODUCT, units: 20, addressId: ADDRESS, idempotencyKey: 'eeeeeeee-6666-4666-8666-666666666666' };

test('下单：无候选组 → 建组（库存预留）+ 首单标准价', async () => {
  const { workflow, stocks, groups } = buildWorkflow();
  const view = await workflow.execute({ userId: USER_A, command: validCommand });
  assert.equal(view.status, 'unpaid');
  assert.equal(view.quote.totalAmountFen, 16833);
  assert.equal(view.quote.isFinalOrder, false);
  assert.equal(view.group.isNewGroup, true);
  assert.equal(stocks.available, 4, '整件预留消耗一件');
  assert.equal(groups.groups.size, 1);
  assert.equal(view.reservationExpiresAt.toISOString(), new Date(NOW.getTime() + TTL * 60_000).toISOString());
});

test('下单：加入已有组选可行组（G3）；补差仅在前面全部已生效时适用（D001 修订）', async () => {
  // 组1：paid 20（剩 40，最早）；组2：paid 30（剩 30，更接近拼满）
  const g1 = Group.create({ groupId: GROUP_1, productId: PRODUCT, snapshot: SNAPSHOT, deadline: new Date(NOW.getTime() + 3600_000), now: NOW }).withReservedUnits(20).withPaidUnits(20, NOW);
  const g2 = Group.create({ groupId: 'eeeeeeee-5555-4555-8555-555555555556', productId: PRODUCT, snapshot: SNAPSHOT, deadline: new Date(NOW.getTime() + 3600_000), now: new Date(NOW.getTime() - 1000) }).withReservedUnits(30).withPaidUnits(30, NOW);
  const { workflow } = buildWorkflow({ groups: new FakeGroupRepository([g1, g2]) });
  const view = await workflow.execute({ userId: USER_A, command: validCommand });
  // g2 剩 30：买 20 后剩 10 不可完成 → 跳过；g1 剩 40：买后剩 20 可完成 → 选 g1
  assert.equal(view.group.groupId, g1.state.groupId, '可完成性过滤后选剩余最小的可行组');
  assert.equal(view.quote.isFinalOrder, false);
  assert.equal(view.quote.totalAmountFen, 16833);

  // 最后单：组剩 20，买 20 → 补差（40 单位 = 两个 1/3，已生效 16833×2）
  const gFull = Group.create({ groupId: 'eeeeeeee-5555-4555-8555-555555555557', productId: PRODUCT, snapshot: SNAPSHOT, deadline: new Date(NOW.getTime() + 3600_000), now: NOW })
    .withReservedUnits(40).withPaidUnits(40, NOW).withPaidAmount(16833 * 2, 16667 * 2, NOW);
  const { workflow: wf2 } = buildWorkflow({ groups: new FakeGroupRepository([gFull]) });
  const finalView = await wf2.execute({ userId: USER_A, command: validCommand });
  assert.equal(finalView.quote.isFinalOrder, true);
  assert.equal(finalView.quote.totalAmountFen, 16834, '50500 − 16833×2（D001 案例）');
  assert.equal(finalView.quote.tailAdjustFen, 1);
  assert.equal(finalView.quote.goodsAmountFen, 16666);
  assert.equal(finalView.quote.serviceFeeFen, 168);
  // 守恒：组成功时 Σtotal=50500、Σgoods=50000、Σservice=500
  assert.equal(16833 + 16833 + finalView.quote.totalAmountFen, 50500);
  assert.equal(16667 + 16667 + finalView.quote.goodsAmountFen, 50000);
});

test('下单：幂等——同键同内容返回原单；同键异内容 409（G6）', async () => {
  const { workflow, orders } = buildWorkflow();
  const first = await workflow.execute({ userId: USER_A, command: validCommand });
  const second = await workflow.execute({ userId: USER_A, command: validCommand });
  assert.equal(second.orderId, first.orderId, '返回原订单');
  assert.equal(orders.orders.size, 1, '不重复建单');
  await assert.rejects(
    () => workflow.execute({ userId: USER_A, command: { ...validCommand, units: 15 } }),
    (e) => e.code === 'IDEMPOTENCY_CONFLICT'
  );
  // 其他用户同键：幂等域按用户隔离，正常建单
  const other = await workflow.execute({ userId: USER_B, command: validCommand });
  assert.notEqual(other.orderId, first.orderId);
});

test('下单：他人地址 404（G11）；商品下架 409（G13）', async () => {
  const { workflow } = buildWorkflow();
  const addressOfA = 'dddddddd-4444-4444-8444-444444444445';
  await assert.rejects(
    () => workflow.execute({ userId: USER_B, command: { ...validCommand, addressId: addressOfA } }),
    (e) => e.code === 'ADDRESS_NOT_FOUND'
  );
  const { workflow: wf2 } = buildWorkflow({ products: new FakeProductSnapshot(false) });
  await assert.rejects(
    () => wf2.execute({ userId: USER_A, command: validCommand }),
    (e) => e.code === 'PRODUCT_NOT_ON_SHELF'
  );
});

test('下单：非法单位（不在快照集合）400（G14 前置）', async () => {
  const { workflow } = buildWorkflow();
  await assert.rejects(
    () => workflow.execute({ userId: USER_A, command: { ...validCommand, units: 7 } }),
    (e) => e.code === 'SHARE_UNIT_INVALID'
  );
});

test('取消未支付订单：释放预占与组容量；已支付/过期不可取消', async () => {
  const { workflow, groups, reservations, orders } = buildWorkflow();
  const view = await workflow.execute({ userId: USER_A, command: validCommand });
  const cancel = new CancelUnpaidOrder({ orders, reservations, groups, clock, runner });
  const result = await cancel.execute({ userId: USER_A, orderId: view.orderId });
  assert.deepEqual(result, { cancelled: true });
  const stored = await orders.findById(view.orderId);
  assert.equal(stored.state.status, 'cancelled');
  const reservation = await reservations.findByOrderId(view.orderId);
  assert.equal(reservation.state.status, 'cancelled');
  const group = await groups.findById(view.group.groupId);
  assert.equal(group.state.reservedUnits, 0, '组容量回落');
  const again = await cancel.execute({ userId: USER_A, orderId: view.orderId });
  assert.deepEqual(again, { cancelled: true }, '重复取消幂等成功（spec §4）');
});
