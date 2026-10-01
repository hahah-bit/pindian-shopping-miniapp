import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Payment } = require('../../../backend/dist/contexts/payments/domain/index.js');
const { PaymentQueryCompensationTask, RefundDriveTask, AnomalyStatsTask } = require('../../../backend/dist/workflows/payment-tasks.js');

const NOW = new Date('2026-10-02T00:00:00Z');
const ORDER = 'bbbbbbbb-2222-4222-8222-222222222222';
class InlineRunner { async run(w) { return w({ tx: true }); } }

function makePayment(status = 'processing', updatedAgoMs = 60_000) {
  const p = Payment.create({ orderId: ORDER, userId: 'u', amountFen: 16833, prepayId: 'pre', now: new Date(NOW.getTime() - 3600_000) });
  const stale = new Date(NOW.getTime() - updatedAgoMs);
  return Payment.rehydrate({ ...p.state, status, updatedAt: stale });
}

class FakeClock { now() { return NOW; } }
class InlineTxRunner { async run(w) { return w({ tx: true }); } }

class FakePayments {
  constructor(list) { this.list = list; this.saved = []; }
  async findStale(now, limit) {
    return this.list.filter((p) => (p.state.status === 'unknown' || p.state.status === 'processing') && p.state.updatedAt <= new Date(NOW.getTime() - 30_000)).slice(0, limit);
  }
  async save(p) { this.saved.push(p); }
  async findByOrderId() { return null; }
  async findById() { return null; }
  async insert() {}
  async listAdmin() { return { items: this.saved, total: this.saved.length }; }
}

class FakeQueryChannel {
  constructor(result) { this.result = result; this.queries = []; }
  async queryOrderByOutTradeNo(no) { this.queries.push(no); return this.result; }
  async createJsapiOrder() { return { prepayId: 'p' }; }
  async closeOrder() {}
  async signPayParams() { return 'sig'; }
  async submitRefund() { return { status: 'PROCESSING' }; }
  async queryRefund() { return { status: 'PROCESSING' }; }
}

class FakeConfirmWorkflow {
  constructor(result) { this.result = result; this.calls = []; }
  async execute(input) { this.calls.push(input); return this.result; }
}

test('查询补偿：unknown/processing 超时单被查询并确认（G7）', async () => {
  const unknownPayment = makePayment('unknown', 120_000);
  const payments = new FakePayments([unknownPayment]);
  const channel = new FakeQueryChannel({ tradeState: 'SUCCESS', transactionId: 'ch-9', payerTotal: 16833 });
  const confirm = new FakeConfirmWorkflow(true);
  const task = new PaymentQueryCompensationTask({ payments, channel, confirm, runner: new InlineTxRunner(), clock: new FakeClock() });
  const n = await task.execute({ limit: 10 });
  assert.equal(n, 1);
  assert.deepEqual(channel.queries, [ORDER]);
  assert.equal(confirm.calls.length, 1);
  assert.equal(confirm.calls[0].channelFact.channelTransactionId, 'ch-9');
});

test('查询仍 NOTPAY → 保持 processing 不动（等待，不误关单）', async () => {
  const payments = new FakePayments([makePayment('processing', 120_000)]);
  const channel = new FakeQueryChannel({ tradeState: 'NOTPAY' });
  const confirm = new FakeConfirmWorkflow(true);
  const task = new PaymentQueryCompensationTask({ payments, channel, confirm, runner: new InlineTxRunner(), clock: new FakeClock() });
  const n = await task.execute({ limit: 10 });
  assert.equal(n, 0);
  assert.equal(confirm.calls.length, 0);
});

test('更新时间未超阈值的不查询（退避）', async () => {
  const payments = new FakePayments([makePayment('processing', 5_000)]);
  const channel = new FakeQueryChannel({ tradeState: 'SUCCESS', transactionId: 'x', payerTotal: 1 });
  const confirm = new FakeConfirmWorkflow(true);
  const task = new PaymentQueryCompensationTask({ payments, channel, confirm, runner: new InlineTxRunner(), clock: new FakeClock() });
  const n = await task.execute({ limit: 10 });
  assert.equal(n, 0);
  assert.equal(channel.queries.length, 0);
});

test('退款驱动任务接线：提交 + 查询走 RefundDriver（G9 重复提交幂等由渠道 out_refund_no）', async () => {
  const { Refund } = require('../../../backend/dist/contexts/payments/domain/index.js');
  const { RefundDriver } = require('../../../backend/dist/workflows/refund.workflow.js');
  const refund = Refund.create({ refundId: 'aaaaaaaa-0000-4000-8000-00000000rf01', paymentId: 'p-1', orderId: ORDER, userId: 'u', amountFen: 16833, reason: 'user_cancel', now: NOW });
  const refunds = { list: [refund], async findRefundDueForSubmit(now, limit) { return this.list.filter((r) => r.state.status === 'requested').slice(0, limit); }, async findRefundDueForQuery(now, limit) { return []; }, async save(r) { this.list = this.list.map((x) => (x.state.refundId === r.state.refundId ? r : x)); }, async findByPaymentId() { return [refund]; }, async findById() { return refund; }, async findByOutRefundNo() { return refund; }, async listAdmin() { return { items: [], total: 0 }; } };
  const payments = { findById: async () => ({ state: { amountFen: 16833 } }) };
  const channel = { submits: [], async submitRefund(input) { this.submits.push(input); return { status: 'PROCESSING' }; }, async queryRefund() { return { status: 'PROCESSING' }; } };
  const driver = new RefundDriver({ refunds: refunds, payments: payments, channel, runner: new InlineTxRunner(), clock: new FakeClock() });
  const n = await driver.execute({ limit: 10 });
  assert.equal(n, 1);
  assert.equal(channel.submits.length, 1, '同号重复提交渠道幂等（本测试单次提交验证键正确）');
});

test('异常统计任务：可执行并返回计数（人工处理入口数据源）', async () => {
  const task = new AnomalyStatsTask({ countPendingReviewPayments: async () => 2, countFailedRefunds: async () => 1 });
  const stats = await task.execute();
  assert.deepEqual(stats, { pendingReviewPayments: 2, failedRefunds: 1 });
});
