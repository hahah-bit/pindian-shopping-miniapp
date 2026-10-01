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
  constructor(g) { this.g = g; this.consumed = []; this.settlements = []; }
  async findByIdForUpdate() { return this.g; }
  async findById() { return this.g; }
  async save(g) { this.g = g; }
  async recordSettlement(input, sessionTx) { this.settlements.push({ ...input, sessionTx }); }
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
  constructor() { this.created = []; this.failNext = null; this.lastSessionTx = undefined; }
  async createFullRefund(input, sessionTx) {
    if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; }
    this.lastSessionTx = sessionTx;
    this.created.push(input);
    return { refundId: `rf-${this.created.length}` };
  }
}

/** 带回滚语义的假事务：work 抛出时把仓储恢复到事务前状态（模拟真实 DB 回滚）。 */
class RollbackRunner {
  constructor(repos) { this.repos = repos; this.lastSessionTx = undefined; }
  async run(work) {
    const snapP = this.repos.payments.p;
    const snapRefunds = [...this.repos.refunds.created];
    const snapG = this.repos.groups.g;
    const snapOrder = this.repos.orders.order;
    const snapR = this.repos.reservations.r;
    const sessionTx = { tx: `s-${this.repos.txSeq = (this.repos.txSeq ?? 0) + 1}` };
    this.lastSessionTx = sessionTx;
    try {
      return await work(sessionTx);
    } catch (error) {
      this.repos.payments.p = snapP;
      this.repos.refunds.created = snapRefunds;
      this.repos.groups.g = snapG;
      this.repos.orders.order = snapOrder;
      this.repos.reservations.r = snapR;
      throw error;
    }
  }
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
  const repos = { groups, reservations, orders, payments, refunds, stocks };
  const runner = overrides.rollbackRunner ? new RollbackRunner(repos) : new InlineRunner();
  const workflow = new ConfirmPaymentWorkflow({
    groups, reservations, orders, payments, refunds, stocks,
    runner, clock: new FakeClock()
  });
  return { groups, reservations, orders, payments, refunds, stocks, workflow, group, order, payment, runner, repos };
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

test('D006 让利台账：组成功同事务落账 expected/settled/diff；未满不落账（A05）', async () => {
  const success = build({ group: makeGroup(40, 20) });
  await success.workflow.execute({ channelFact: SUCCESS, source: 'query' });
  assert.equal(success.groups.settlements.length, 1, '组成功落账一次');
  const entry = success.groups.settlements[0];
  assert.equal(entry.groupId, GROUP);
  assert.equal(entry.expectedTotalFen, 50500, '整件售价快照 = 原价 50000 + 服务费 500');
  assert.equal(entry.settledTotalFen, 16833, '组累计已支付金额');
  assert.equal(entry.diffFen, 50500 - 16833, 'diff = expected - settled（让利可追溯）');
  assert.ok(entry.sessionTx, '落账在事务会话内');

  const unpaid = build();
  await unpaid.workflow.execute({ channelFact: SUCCESS, source: 'query' });
  assert.deepEqual(unpaid.groups.settlements, [], '未满组不落账');
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

test('迟到支付退款建单失败 → 事务回滚支付单不落 succeeded；重放恢复恰好一笔退款（A03）', async () => {
  const expiredOrder = makeOrder().markExpired(NOW);
  const { workflow, refunds, payments } = build({ order: expiredOrder, rollbackRunner: true });
  refunds.failNext = new Error('注入：退款建单失败');
  await assert.rejects(
    () => workflow.execute({ channelFact: SUCCESS, source: 'callback' }),
    /退款建单失败/
  );
  const afterFailure = (await payments.findByOrderId(ORDER)).state;
  assert.notEqual(afterFailure.status, 'succeeded', '回滚：支付事实与退款同事务，退款失败不得落 succeeded');
  // 故障恢复后重放同一支付事实 → 重建退款（重放不再被 succeeded 早退挡住）
  const replay = await workflow.execute({ channelFact: SUCCESS, source: 'callback' });
  assert.equal(replay, false);
  assert.deepEqual(refunds.created.map((r) => r.reason), ['late_payment'], '恢复后恰好一笔退款');
  assert.equal((await payments.findByOrderId(ORDER)).state.appliedResult, 'refunded_not_applied');
  assert.ok(refunds.lastSessionTx, '退款建单收到 sessionTx');
});

test('迟到支付：支付事实保存与退款建单在同一事务（A03 事务边界）', async () => {
  const expiredOrder = makeOrder().markExpired(NOW);
  const { workflow, refunds, runner, payments } = build({ order: expiredOrder, rollbackRunner: true });
  await workflow.execute({ channelFact: SUCCESS, source: 'callback' });
  assert.ok(runner.lastSessionTx, '经过事务运行器');
  assert.equal(refunds.lastSessionTx, runner.lastSessionTx, '退款建单在事务会话内');
  assert.equal((await payments.findByOrderId(ORDER)).state.appliedResult, 'refunded_not_applied');
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
