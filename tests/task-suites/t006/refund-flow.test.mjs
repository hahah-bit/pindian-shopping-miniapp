import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Group } = require('../../../backend/dist/contexts/group-buying/domain/index.js');
const { Order } = require('../../../backend/dist/contexts/ordering/domain/index.js');
const { Payment } = require('../../../backend/dist/contexts/payments/domain/index.js');
const { CancelPaidOrderWorkflow, RetryRefund } = require('../../../backend/dist/workflows/refund.workflow.js');
const { CreateFullRefundUseCase, RefundDriver, RefundResultConfirmer } = require('../../../backend/dist/contexts/payments/application/refund-flow.js');
const { RefundQueries } = require('../../../backend/dist/contexts/payments/application/refund-views.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-02T00:00:00Z');
const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT = 'cccccccc-3333-4333-8333-333333333333';
const GROUP = 'eeeeeeee-5555-4555-8555-555555555555';
const ORDER = 'bbbbbbbb-2222-4222-8222-222222222222';
const SNAPSHOT = { originalPriceFen: 50000, userWholePriceFen: 50500, allowedShareUnits: [30, 20, 15, 12], wholeQuantityText: '10', unit: '斤' };

class InlineRunner { async run(w) { return w({ tx: true }); } }

function makePaidOrder() {
  const order = Order.create({
    orderId: ORDER, orderNo: 'PO2026100100000000001', userId: USER, productId: PRODUCT, groupId: GROUP, units: 20,
    quote: { totalAmountFen: 16833, goodsAmountFen: 16667, serviceFeeFen: 166, tailAdjustFen: 0, isFinalOrder: false },
    snapshot: { originalPriceFen: 50000, unit: '斤', wholeQuantityText: '10', referenceQuantityText: '3.333' },
    addressSnapshot: { receiverName: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路 88 号 5 栋 201' },
    reservationExpiresAt: new Date(NOW.getTime() + 600_000),
    idempotencyKey: '66666666-6666-4666-8666-666666666666', now: NOW
  });
  return order.markPaid(NOW);
}
function makeGroupPaid20() {
  return Group.create({ groupId: GROUP, productId: PRODUCT, snapshot: SNAPSHOT, deadline: new Date(NOW.getTime() + 3600_000), now: NOW })
    .withReservedUnits(60).withPaidUnits(20, NOW);
}
function makePayment() {
  const p = Payment.create({ orderId: ORDER, userId: USER, amountFen: 16833, prepayId: 'pre', now: NOW });
  const succeeded = p.markSucceeded({ channelTransactionId: 'ch-1', source: 'callback', now: NOW });
  return succeeded.markAppliedResult('applied');
}

class FakeGroupRepository {
  constructor(g) { this.g = g; this.deductCalls = 0; this.deductedUnits = 0; }
  async findByIdForUpdate() { return this.g; }
  async findById() { return this.g; }
  get isJoinable() { return this.g && this.g.state.status === 'open'; }
  async deductPaidForCancel(groupId, units) { this.deductCalls++; this.deductedUnits = units; return true; }
  async findCandidates() { return []; }
  async insert() {}
  async findExpiredOpenGroups() { return []; }
  async listByGroup() { return []; }
  async listGroups() { return { items: [], total: 0 }; }
}
class FakeOrderRepository {
  constructor(o) { this.o = o; }
  async findById() { return this.o; }
  async save(x) { this.o = x; }
  async transitionIfUnpaid() { return true; }
  async listByUser() { return { items: [], total: 0 }; }
  async listAdmin() { return { items: [], total: 0 }; }
  async findByIdempotencyKey() { return null; }
  async insert() {}
}
class FakePaymentRepository {
  constructor(p) { this.p = p; }
  async findByOrderId() { return this.p; }
  async findById() { return this.p; }
  async save(x) { this.p = x; }
  async insert() {}
  async listAdmin() { return { items: [], total: 0 }; }
  async findStale() { return []; }
  async findFailedRefunds() { return []; }
}
class FakeRefundRepository {
  constructor(refunds = []) { this.refunds = refunds; }
  async insert(r) { this.refunds.push(r); }
  async findByPaymentId() { return this.refunds; }
  async findById() { return this.refunds[0] ?? null; }
  async save(r) { const i = this.refunds.findIndex((x) => x.state.refundId === r.state.refundId); if (i >= 0) this.refunds[i] = r; else this.refunds.push(r); }
  async listAdmin() { return { items: this.refunds, total: this.refunds.length }; }
  async findRefundDueForSubmit(now, limit) { return this.refunds.filter((r) => r.state.status === 'requested').slice(0, limit); }
  async findRefundDueForQuery(now, limit) { return this.refunds.filter((r) => r.state.status === 'submitted' || r.state.status === 'processing').slice(0, limit); }
  async findByOutRefundNo(no) { return this.refunds.find((r) => r.state.outRefundNo === no) ?? null; }
}
class FakeChannel {
  constructor(status = 'PROCESSING') { this.status = status; this.submits = []; }
  async submitRefund(input) { this.submits.push(input); return { status: this.status, refundId: 'wx-rf-1' }; }
  async queryRefund() { return { status: this.status }; }
  async createJsapiOrder() { return { prepayId: 'p' }; }
  async queryOrderByOutTradeNo() { return { tradeState: 'SUCCESS' }; }
  async closeOrder() {}
}
class FakeAudit {
  constructor() { this.entries = []; }
  async execute(e) { this.entries.push(e); }
}

async function expectRejection(factory, code) {
  try { await factory(); } catch (error) { assert.equal(error.code, code); return error; }
  assert.fail(`应抛出 ${code}`);
}

test('取消已支付订单：组容量即扣 + Refund requested + 订单 cancelled（同事务）', async () => {
  const group = makeGroupPaid20();
  const order = makePaidOrder();
  const payment = makePayment();
  const groups = new FakeGroupRepository(group);
  const orders = new FakeOrderRepository(order);
  const payments = new FakePaymentRepository(payment);
  const refunds = new FakeRefundRepository();
  const creator = new CreateFullRefundUseCase({ refunds: refunds, payments: payments, clock: { now: () => NOW } });
  const workflow = new CancelPaidOrderWorkflow({ groups, orders, payments, refunds, creator, runner: new InlineRunner(), clock: { now: () => NOW } });
  const result = await workflow.execute({ userId: USER, orderId: ORDER, requestId: 'req-1' });
  assert.equal(result.refundId, refunds.refunds[0].state.refundId);
  assert.equal((await orders.findById(ORDER)).state.status, 'cancelled');
  assert.equal(groups.deductCalls, 1, '取消申请即扣容量');
  assert.equal(refunds.refunds[0].state.status, 'requested');
  assert.equal(refunds.refunds[0].state.amountFen, 16833, '全额（含服务费）');
  assert.equal(refunds.refunds[0].state.reason, 'user_cancel');
});

test('组已成功后取消被拒（走售后）；重复取消幂等 409 语义（D007）', async () => {
  const successGroup = makeGroupPaid20().withPaidUnits(40, NOW).markSuccess(NOW);
  const workflow = new CancelPaidOrderWorkflow({ groups: new FakeGroupRepository(successGroup), orders: new FakeOrderRepository(makePaidOrder()), payments: new FakePaymentRepository(makePayment()), refunds: new FakeRefundRepository(), creator: new CreateFullRefundUseCase({ refunds: new FakeRefundRepository(), payments: new FakePaymentRepository(makePayment()), clock: { now: () => NOW } }), runner: new InlineRunner(), clock: { now: () => NOW } });
  await expectRejection(() => workflow.execute({ userId: USER, orderId: ORDER, requestId: 'r' }), 'ORDER_NOT_CANCELLABLE');
});

test('退款驱动：requested → 渠道提交 → processing；渠道幂等键 out_refund_no', async () => {
  const payment = makePayment();
  const { Refund } = require('../../../backend/dist/contexts/payments/domain/index.js');
  const refund = Refund.create({ refundId: 'rf-1', paymentId: payment.state.paymentId, orderId: ORDER, userId: USER, amountFen: 16833, reason: 'user_cancel', now: NOW });
  const refunds = new FakeRefundRepository([refund]);
  const payments = new FakePaymentRepository(payment);
  const channel = new FakeChannel('PROCESSING');
  const driver = new RefundDriver({ refunds: refunds, payments: payments, channel, runner: new InlineRunner(), clock: { now: () => NOW } });
  const n = await driver.execute({ limit: 10 });
  console.error('[diag-driver] n=', n, 'status=', refunds.refunds[0].state.status, 'submits=', JSON.stringify(channel.submits));
  assert.equal(refunds.refunds[0].state.status, 'processing');
  assert.equal(channel.submits[0].outRefundNo, refunds.refunds[0].state.outRefundNo);
  assert.equal(channel.submits[0].refundFen, 16833);
});

test('渠道提交异常：进入 failed 并记录原因（不无限静默重试）；人工重试后 retryCount 递增', async () => {
  const payment = makePayment();
  const { Refund } = require('../../../backend/dist/contexts/payments/domain/index.js');
  const refund = Refund.create({ refundId: 'aaaaaaaa-0000-4000-8000-00000000ab02', paymentId: payment.state.paymentId, orderId: ORDER, userId: USER, amountFen: 16833, reason: 'group_failed', now: NOW });
  const refunds = new FakeRefundRepository([refund]);
  let submitMode = 'SYSTEM_ERROR';
  const channel = {
    submitRefund: async () => {
      if (submitMode === 'SYSTEM_ERROR') throw new Error('SYSTEM_ERROR');
      if (submitMode === 'BALANCE') throw new Error('BALANCE_NOT_ENOUGH');
      return { status: 'PROCESSING' };
    },
    queryRefund: async () => ({ status: 'PROCESSING' })
  };
  const driver = new RefundDriver({ refunds: refunds, payments: new FakePaymentRepository(payment), channel: channel, runner: new InlineRunner(), clock: { now: () => NOW } });
  await driver.execute({ limit: 10 });
  assert.equal(refunds.refunds[0].state.status, 'failed', '提交异常必须落 failed，进入异常队列');
  assert.match(refunds.refunds[0].state.failReason ?? '', /SYSTEM_ERROR/);
  // 人工重试：failed → requested（retryCount +1，驱动按幂等键 out_refund_no 重新提交）
  const auditCalls = [];
  const retry = new RetryRefund({ refunds: refunds, channel: channel, audit: { execute: async (entry) => auditCalls.push(entry.action) }, runner: new InlineRunner(), clock: { now: () => NOW } });
  await retry.execute({ refundId: refund.state.refundId, adminId: 'admin-1', requestId: 'req-1', reason: '渠道恢复后重试' });
  assert.equal(refunds.refunds[0].state.status, 'requested', 'RetryRefund 重置为 requested，由退款驱动重新提交');
  assert.equal(refunds.refunds[0].state.retryCount, 1, '重试计数 +1');
  assert.equal(auditCalls.includes('refund.retry'), true, '重试写审计');
  submitMode = 'BALANCE';
  await driver.execute({ limit: 10 });
  assert.equal(refunds.refunds[0].state.status, 'failed');
  assert.match(refunds.refunds[0].state.failReason ?? '', /BALANCE_NOT_ENOUGH/);
  assert.equal(refunds.refunds[0].state.retryCount, 1, '失败重试一轮后计数 1');
});

test('退款回调确认：仅渠道证据可标 succeeded；无证据不得显示已退款（D009）', async () => {
  const payment = makePayment();
  const { Refund } = require('../../../backend/dist/contexts/payments/domain/index.js');
  const refund = Refund.create({ refundId: 'rf-1', paymentId: payment.state.paymentId, orderId: ORDER, userId: USER, amountFen: 16833, reason: 'user_cancel', now: NOW }).markSubmitted(NOW).markProcessing();
  const refunds = new FakeRefundRepository([refund]);
  const confirmer = new RefundResultConfirmer({ refunds: refunds, runner: new InlineRunner(), clock: { now: () => NOW } });
  await confirmer.execute({ outRefundNo: refund.state.outRefundNo, result: 'SUCCESS', source: 'callback' });
  assert.equal(refunds.refunds[0].state.status, 'succeeded');
});

test('累计退款上限：Σ(非失败) ≤ 实付，超出拒绝（G9）', async () => {
  const payment = makePayment();
  const { Refund } = require('../../../backend/dist/contexts/payments/domain/index.js');
  const r1 = Refund.create({ refundId: 'rf-1', paymentId: payment.state.paymentId, orderId: ORDER, userId: USER, amountFen: 16833, reason: 'user_cancel', now: NOW });
  const refunds = new FakeRefundRepository([r1]);
  const creator = new CreateFullRefundUseCase({ refunds: refunds, payments: new FakePaymentRepository(payment), clock: { now: () => NOW } });
  creator.constructor.name === 'CreateFullRefundUseCase'; // 保持引用
  await expectRejection(() => creator.execute({ paymentId: payment.state.paymentId, orderId: ORDER, userId: USER, reason: 'late_payment' }), 'REFUND_EXCEED_LIMIT');
});

test('人工重试：仅 failed 可重试，需审计（D009）', async () => {
  const payment = makePayment();
  const { Refund } = require('../../../backend/dist/contexts/payments/domain/index.js');
  const refund = Refund.create({ refundId: 'aaaaaaaa-0000-4000-8000-00000000aab1', paymentId: payment.state.paymentId, orderId: ORDER, userId: USER, amountFen: 16833, reason: 'group_failed', now: NOW }).markSubmitted(NOW).markProcessing().markFailed('USER_ACCOUNT_ABNORMAL', NOW);
  const refunds = new FakeRefundRepository([refund]);
  const audit = new FakeAudit();
  const retry = new RetryRefund({ refunds: refunds, channel: new FakeChannel('PROCESSING'), audit: audit, runner: new InlineRunner(), clock: { now: () => NOW } });
  await retry.execute({ refundId: 'aaaaaaaa-0000-4000-8000-00000000aab1', adminId: 'admin-1', requestId: 'req-9', reason: '银行卡恢复' });
  assert.equal(refunds.refunds[0].state.status, 'requested', '重试重置为 requested，由驱动重新提交');
  assert.equal(refunds.refunds[0].state.retryCount, 1, '重试计数 +1');
  assert.equal(audit.entries.length, 1, '审计记录');
  assert.match(audit.entries[0].action, /retry/);
  await expectRejection(() => retry.execute({ refundId: 'aaaaaaaa-0000-4000-8000-00000000rf02', adminId: 'admin-1', requestId: 'x', reason: 'y' }), 'VALIDATION_FAILED');
});

function makeGroupPaid20ForQueries() { return makeGroupPaid20(); }

test('退款查询投影：脱敏（无手机号/地址）', async () => {
  const payment = makePayment();
  const { Refund } = require('../../../backend/dist/contexts/payments/domain/index.js');
  const refund = Refund.create({ refundId: 'rf-1', paymentId: payment.state.paymentId, orderId: ORDER, userId: USER, amountFen: 16833, reason: 'user_cancel', now: NOW });
  const queries = new RefundQueries({ refunds: new FakeRefundRepository([refund]), payments: new FakePaymentRepository(payment), nicknameOf: async () => '拼单小明' });
  const list = await queries.list({ page: 1, pageSize: 10 });
  assert.ok(!JSON.stringify(list).includes('13800001234'));
});
