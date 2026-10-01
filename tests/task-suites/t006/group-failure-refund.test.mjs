import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FailDeadlineGroupsTask } = require('../../../backend/dist/workflows/order-expiry.tasks.js');
const { Group, ShareReservation } = require('../../../backend/dist/contexts/group-buying/domain/index.js');
const { Order } = require('../../../backend/dist/contexts/ordering/domain/index.js');
const { Payment } = require('../../../backend/dist/contexts/payments/domain/index.js');

const NOW = new Date('2026-10-02T00:00:00Z');
const PAST = new Date(NOW.getTime() - 3600_000);
const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT = 'cccccccc-3333-4333-8333-333333333333';
const GROUP = 'eeeeeeee-5555-4555-8555-555555555555';
const SNAPSHOT = { originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' };

class FakeClock { now() { return NOW; } }
class InlineRunner { async run(w) { return w({ tx: true }); } }

function makeGroup() {
  return Group.create({ groupId: GROUP, productId: PRODUCT, snapshot: SNAPSHOT, deadline: PAST, now: new Date(PAST.getTime() - 1000) })
    .withReservedUnits(20).withPaidUnits(20, NOW);
}

function makePaidOrder(orderId) {
  return Order.create({
    orderId, orderNo: `PO-${orderId.slice(-6)}`, userId: USER, productId: PRODUCT, groupId: GROUP, units: 20,
    quote: { totalAmountFen: 16833, goodsAmountFen: 16667, serviceFeeFen: 166, tailAdjustFen: 0, isFinalOrder: false },
    snapshot: { originalPriceFen: 50000, unit: '斤', wholeQuantityText: '10', referenceQuantityText: '3.333' },
    addressSnapshot: { receiverName: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路 88 号' },
    reservationExpiresAt: PAST, idempotencyKey: `77777777-7777-4777-8777-${orderId.slice(-12)}`, now: new Date(PAST.getTime() - 1000)
  }).markPaid(NOW);
}

class FakeGroupRepository {
  constructor(groups) { this.groups = groups; this.released = []; }
  async findExpiredOpenGroups() { return this.groups.filter((g) => g.isOpen && g.state.deadline <= NOW); }
  async findByIdForUpdate(id) { return this.groups.find((g) => g.state.groupId === id) ?? null; }
  async save(g) { const i = this.groups.findIndex((x) => x.state.groupId === g.state.groupId); if (i >= 0) this.groups[i] = g; }
  async listByGroup() { return []; }
}

class FakeOrderRepository {
  constructor(orders) { this.orders = orders; }
  async transitionIfUnpaid() { return true; }
  async listPaidWithoutRefundInFailedGroups() {
    // 真实实现：failed 组内 paid 且无退款单；fake 按 pendingRefunds 过滤
    return this.orders.filter((o) => !this.pendingRefunds?.has(o.state.orderId));
  }
}

class FakeStockPort {
  constructor() { this.released = []; }
  async releaseOne(productId, key) { this.released.push(key); }
  async consumeOne() {}
  async reserveOne() {}
}

class FakePaymentRepository {
  constructor(payments) { this.payments = payments; }
  async findByOrderId(orderId) { return this.payments.find((p) => p.state.orderId === orderId) ?? null; }
}

class FakeRefunds {
  constructor() { this.created = []; this.failOrderIds = new Set(); }
  async createFullRefund(input) {
    if (this.failOrderIds.has(input.orderId)) throw new Error('注入：该单退款建单失败');
    this.created.push(input);
    return { refundId: `rf-${this.created.length}` };
  }
}

function buildTask({ groups, orders, payments, refunds }) {
  return new FailDeadlineGroupsTask({
    groups, orders,
    reservations: { findExpired: async () => [], save: async () => {}, listByGroup: async () => [] },
    stocks: new FakeStockPort(),
    payments, refunds,
    runner: new InlineRunner(),
    clock: new FakeClock()
  });
}

function makePayment(orderId) {
  return Payment.create({ orderId, userId: USER, amountFen: 16833, prepayId: 'prepay-x', now: NOW, status: 'succeeded' });
}

test('组截止失败：已支付订单获得 group_failed 全额退款（A02）', async () => {
  const group = makeGroup();
  const orderId = 'bbbbbbbb-2222-4222-8222-222222222221';
  const orders = new FakeOrderRepository([makePaidOrder(orderId)]);
  orders.pendingRefunds = new Set();
  const refunds = new FakeRefunds();
  const task = buildTask({ groups: new FakeGroupRepository([group]), orders, payments: new FakePaymentRepository([makePayment(orderId)]), refunds });
  const processed = await task.execute({ limit: 10 });
  assert.equal(processed, 2, '组失效 1 + 退款建单 1');
  assert.deepEqual(refunds.created.map((r) => r.reason), ['group_failed']);
  assert.equal(refunds.created[0].amountFen, 16833, '全额（含服务费）');
  assert.equal(refunds.created[0].orderId, orderId);
});

test('组截止幂等：已有退款的订单不重复建单；重复执行零新增（A02）', async () => {
  const group = makeGroup();
  const orderId = 'bbbbbbbb-2222-4222-8222-222222222222';
  const orders = new FakeOrderRepository([makePaidOrder(orderId)]);
  const refunds = new FakeRefunds();
  const payments = new FakePaymentRepository([makePayment(orderId)]);
  const task = buildTask({ groups: new FakeGroupRepository([group]), orders, payments, refunds });
  await task.execute({ limit: 10 });
  // 第二轮：该订单已有退款（finder 排除）
  orders.pendingRefunds = new Set([orderId]);
  const created = refunds.created.length;
  await task.execute({ limit: 10 });
  assert.equal(refunds.created.length, created, '不重复建单');
});

test('部分失败：单笔退款失败不影响其他订单；下一轮重扫补齐（重启恢复语义）', async () => {
  const group = makeGroup();
  const orderA = 'bbbbbbbb-2222-4222-8222-222222222223';
  const orderB = 'bbbbbbbb-2222-4222-8222-222222222224';
  const orders = new FakeOrderRepository([makePaidOrder(orderA), makePaidOrder(orderB)]);
  const refunds = new FakeRefunds();
  refunds.failOrderIds.add(orderA);
  const payments = new FakePaymentRepository([makePayment(orderA), makePayment(orderB)]);
  const task = buildTask({ groups: new FakeGroupRepository([group]), orders, payments, refunds });
  await task.execute({ limit: 10 });
  assert.deepEqual(refunds.created.map((r) => r.orderId), [orderB], '失败单不阻塞其他单');
  // 下一轮（故障恢复）：失败单重试成功
  refunds.failOrderIds.clear();
  await task.execute({ limit: 10 });
  assert.ok(refunds.created.some((r) => r.orderId === orderA), '重扫补齐失败单退款');
  assert.equal(refunds.created.filter((r) => r.orderId === orderA).length, 1, '恰好一笔');
});

test('组截止：无已支付订单 → 不建退款（仅失效）', async () => {
  const group = makeGroup();
  const orders = new FakeOrderRepository([]);
  const refunds = new FakeRefunds();
  const task = buildTask({ groups: new FakeGroupRepository([group]), orders, payments: new FakePaymentRepository([]), refunds });
  await task.execute({ limit: 10 });
  assert.deepEqual(refunds.created, []);
});
