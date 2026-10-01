import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Group } = require('../../../backend/dist/contexts/group-buying/domain/index.js');
const { Order } = require('../../../backend/dist/contexts/ordering/domain/index.js');
const { ShareReservation } = require('../../../backend/dist/contexts/group-buying/domain/index.js');
const { Payment } = require('../../../backend/dist/contexts/payments/domain/index.js');
const { ConfirmPaymentWorkflow } = require('../../../backend/dist/workflows/payment-confirm.workflow.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-02T00:00:00Z');
const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT = 'cccccccc-3333-4333-8333-333333333333';
const GROUP = 'eeeeeeee-5555-4555-8555-555555555555';
const ORDER = 'bbbbbbbb-2222-4222-8222-222222222222';
const SNAPSHOT = { originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' };

class FakeClock { now() { return NOW; } }
class InlineRunner { async run(w) { return w({ tx: true }); } }

function makeGroup(paid = 0, reserved = 20) {
  return Group.create({ groupId: GROUP, productId: PRODUCT, snapshot: SNAPSHOT, deadline: new Date(NOW.getTime() + 3600_000), now: NOW })
    .withReservedUnits(paid + reserved).withPaidUnits(paid, NOW);
}
// 注：withPaidUnits 同时扣 reserved，故上面先预占 paid+reserved 再转 paid，剩余 reserved
function makeReservation(units = 20, expiresAt = new Date(NOW.getTime() + 600_000)) {
  return ShareReservation.create({ reservationId: 'r-1', groupId: GROUP, orderId: ORDER, units, expiresAt, now: NOW });
}
function makeOrder(units = 20) {
  return Order.create({
    orderId: ORDER, orderNo: 'PO2026100100000000001', userId: USER, productId: PRODUCT, groupId: GROUP, units,
    quote: { totalAmountFen: 16833, goodsAmountFen: 16667, serviceFeeFen: 166, tailAdjustFen: 0, isFinalOrder: false },
    snapshot: { originalPriceFen: 50000, unit: '斤', wholeQuantityText: '10', referenceQuantityText: '3.333' },
    addressSnapshot: { receiverName: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路 88 号 5 栋 201' },
    reservationExpiresAt: new Date(NOW.getTime() + 600_000),
    idempotencyKey: '66666666-6666-4666-8666-666666666666', now: NOW
  });
}
function makePayment() {
  return Payment.create({ orderId: ORDER, userId: USER, amountFen: 16833, prepayId: 'prepay-x', now: NOW });
}

class FakePaymentRepository {
  constructor(p) { this.p = p; }
  async findByOrderId(orderId) { return this.p && this.p.state.orderId === orderId ? this.p : null; }
  async insert(x) { this.p = x; }
  async save(x) { this.p = x; }
}

class FakeOrderRepository {
  constructor(order) { this.order = order; }
  async findById() { return this.order; }
  async save(o) { this.order = o; }
  async transitionIfUnpaid() { return true; }
  async listByUser() { return { items: [], total: 0 }; }
  async listAdmin() { return { items: [], total: 0 }; }
  async findByIdempotencyKey() { return null; }
  async insert() {}
}
class FakeReservationRepository {
  constructor(r) { this.r = r; }
  async findByOrderId() { return this.r; }
  async save(x) { this.r = x; }
  async insert() {}
  async findExpired() { return []; }
  async listByGroup() { return this.r ? [this.r] : []; }
}
class FakeGroupRepository {
  constructor(g) { this.g = g; this.consumed = []; }
  async findByIdForUpdate() { return this.g; }
  async findById() { return this.g; }
  async save(g) { this.g = g; }
  async findCandidates() { return []; }
  async insert() {}
  async findExpiredOpenGroups() { return []; }
  async listGroups() { return { items: [], total: 0 }; }
  async listByGroup() { return []; }
}
class FakeStockPort {
  constructor() { this.consumed = []; }
  async consumeOne(productId, key) { this.consumed.push(key); }
  async reserveOne() {}
  async releaseOne() {}
}
class FakeRefundCreator {
  constructor() { this.created = []; }
  async createFullRefund(input) { this.created.push(input); return { refundId: 'rf-1' }; }
}

function build(overrides = {}) {
  const group = overrides.group ?? makeGroup();
  const reservation = overrides.reservation ?? makeReservation();
  const order = overrides.order ?? makeOrder();
  const payment = overrides.payment ?? makePayment();
  const groups = new FakeGroupRepository(group);
  const reservations = new FakeReservationRepository(reservation);
  const orders = new FakeOrderRepository(order);
  const payments = new FakePaymentRepository(payment);
  const refunds = new FakeRefundCreator();
  const stocks = new FakeStockPort();
  const workflow = new ConfirmPaymentWorkflow({
    groups, reservations, orders, payments, refunds, stocks,
    runner: new InlineRunner(), clock: new FakeClock()
  });
  return { groups, reservations, orders, payments, refunds, stocks, workflow, group, order, payment };
}

const SUCCESS = { outTradeNo: ORDER, channelTransactionId: 'ch-tx-1', payerTotal: 16833, payload: { mock: true } };

test('支付确认：预占转已支付 + 组金额/单位更新 + 订单 paid（未满不成功）', async () => {
  const { workflow, groups, orders, reservations, payments } = build();
  const applied = await workflow.execute({ channelFact: SUCCESS, source: 'callback' });
  assert.equal(applied, true);
  const g = (await groups.findById(GROUP)).state;
  assert.equal(g.paidUnits, 20);
  assert.equal(g.reservedUnits, 0, '预占转已支付，总占用不变');
  assert.equal(g.paidAmountFen, 16833);
  const o = (await orders.findById(ORDER)).state;
  assert.equal(o.status, 'paid');
  const r = (await reservations.findByOrderId(ORDER)).state;
  assert.equal(r.status, 'converted');
  assert.equal((await payments.findByOrderId(ORDER)).state.appliedResult, 'applied');
});

test('组满判定：支付使 paid 恰为 60 → 组 success + 整件消耗（G4/G5）', async () => {
  const { workflow, groups, stocks } = build({ group: makeGroup(40, 20) });
  const applied = await workflow.execute({ channelFact: SUCCESS, source: 'query' });
  const g = (await groups.findById(GROUP)).state;
  
  assert.equal(applied, true);
  assert.equal(g.paidUnits, 60);
  assert.equal(g.status, 'success', '恰好 60 才成功');
  assert.deepEqual(stocks.consumed, [`group-consume:${GROUP}`], '组成功消耗整件');
});

test('重复通知：已应用过直接幂等返回，不重复占容量（G3）', async () => {
  const { workflow, groups } = build();
  await workflow.execute({ channelFact: SUCCESS, source: 'callback' });
  const before = (await groups.findById(GROUP)).state;
  const second = await workflow.execute({ channelFact: { ...SUCCESS, channelTransactionId: 'ch-tx-1' }, source: 'query' });
  assert.equal(second, true, '幂等成功返回');
  const after = (await groups.findById(GROUP)).state;
  assert.equal(after.paidUnits, before.paidUnits, '不重复应用');
});

test('金额不符：支付事实入库 + pending_review 异常（G10）', async () => {
  const { workflow, payments, orders } = build();
  const applied = await workflow.execute({ channelFact: { ...SUCCESS, payerTotal: 1 }, source: 'callback' });
  assert.equal(applied, false);
  assert.equal((await payments.findByOrderId(ORDER)).state.appliedResult, 'pending_review');
  assert.equal((await orders.findById(ORDER)).state.status, 'unpaid', '金额不符不生效');
});

test('迟到支付：订单已过期 → 事实入库 + 全额自动退款（G6/D008）', async () => {
  const expiredOrder = makeOrder().markExpired(NOW);
  const { workflow, refunds, orders, payments } = build({ order: expiredOrder });
  const applied = await workflow.execute({ channelFact: SUCCESS, source: 'callback' });
  assert.equal(applied, false);
  assert.equal((await payments.findByOrderId(ORDER)).state.appliedResult, 'refunded_not_applied');
  assert.deepEqual(refunds.created.map((r) => r.reason), ['late_payment']);
  assert.equal(refunds.created[0].amountFen, 16833, '全额退款');
  assert.equal((await orders.findById(ORDER)).state.status, 'expired', '订单保持 expired');
});

test('组已成功后的迟到支付：同样全额自动退款', async () => {
  const successGroup = makeGroup(40, 20).withPaidUnits(20, NOW).markSuccess(NOW);
  const { workflow, refunds } = build({ group: successGroup });
  await workflow.execute({ channelFact: SUCCESS, source: 'query' });
  assert.deepEqual(refunds.created.map((r) => r.reason), ['late_payment']);
});

test('预占已过期但订单未过期（任务未跑）→ 视为不可生效，全额退款', async () => {
  const expiredReservation = ShareReservation.rehydrate({ ...makeReservation().state, expiresAt: new Date(NOW.getTime() - 1000) });
  const { workflow, refunds } = build({ reservation: expiredReservation });
  await workflow.execute({ channelFact: SUCCESS, source: 'callback' });
  assert.deepEqual(refunds.created.map((r) => r.reason), ['late_payment']);
});
