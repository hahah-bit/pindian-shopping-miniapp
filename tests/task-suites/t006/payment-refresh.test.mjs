import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PaymentQueryResult } = require('../../../backend/dist/contexts/payments/application/payment-query-result.js');
const { Order } = require('../../../backend/dist/contexts/ordering/domain/index.js');
const { Payment } = require('../../../backend/dist/contexts/payments/domain/index.js');

const NOW = new Date('2026-10-02T00:00:00Z');
const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRODUCT = 'cccccccc-3333-4333-8333-333333333333';
const GROUP = 'eeeeeeee-5555-4555-8555-555555555555';
const ORDER = 'bbbbbbbb-2222-4222-8222-222222222222';

function makeOrder(status = 'unpaid') {
  const order = Order.create({
    orderId: ORDER, orderNo: 'PO-1', userId: USER, productId: PRODUCT, groupId: GROUP, units: 20,
    quote: { totalAmountFen: 16833, goodsAmountFen: 16667, serviceFeeFen: 166, tailAdjustFen: 0, isFinalOrder: false },
    snapshot: { originalPriceFen: 50000, unit: '斤', wholeQuantityText: '10', referenceQuantityText: '3.333' },
    addressSnapshot: { receiverName: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园南路 88 号' },
    reservationExpiresAt: new Date(NOW.getTime() + 600_000), idempotencyKey: '66666666-6666-4666-8666-666666666666', now: NOW
  });
  return status === 'paid' ? order.markPaid(NOW) : order;
}

function makePayment(status) {
  if (status === 'processing') return Payment.create({ orderId: ORDER, userId: USER, amountFen: 16833, prepayId: 'p1', now: NOW });
  if (status === 'succeeded') return Payment.create({ orderId: ORDER, userId: USER, amountFen: 16833, prepayId: 'p1', now: NOW }).markSucceeded({ channelTransactionId: 'ch-done', source: 'callback', now: NOW });
  return Payment.createUnknown({ orderId: ORDER, userId: USER, amountFen: 16833, now: NOW });
}

class FakePaymentRepository {
  constructor(p) { this.p = p; }
  async findByOrderId() { return this.p; }
  async save(x) { this.p = x; }
  async insert() {}
}
class FakeOrderRepository {
  constructor(o) { this.o = o; }
  async findById() { return this.o; }
  async save(x) { this.o = x; }
}
class FakeChannel {
  constructor(result) { this.result = result; this.queries = []; }
  async queryOrderByOutTradeNo(no) {
    this.queries.push(no);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}
class FakeConfirm {
  constructor() { this.calls = []; }
  async execute(input) { this.calls.push(input); return true; }
}

function build({ order, payment, channelResult = { tradeState: 'SUCCESS', transactionId: 'ch-1', payerTotal: 16833 } }) {
  const payments = new FakePaymentRepository(payment);
  const orders = new FakeOrderRepository(order);
  const channel = new FakeChannel(channelResult);
  const confirm = new FakeConfirm();
  const useCase = new PaymentQueryResult({
    payments, orders,
    payConfig: { configured: true },
    channel, confirm,
    runner: { async run(w) { return w({ tx: 1 }); } },
    clock: { now: () => NOW }
  });
  return { useCase, channel, confirm, orders, payments };
}

test('刷新语义：processing 单触发渠道查单并确认（R7）', async () => {
  const { useCase, channel, confirm } = build({ order: makeOrder('unpaid'), payment: makePayment('processing') });
  const view = await useCase.execute({ orderId: ORDER, userId: USER });
  assert.deepEqual(channel.queries, [ORDER], '后端主动查单');
  assert.equal(confirm.calls.length, 1);
  assert.equal(confirm.calls[0].source, 'query');
  assert.equal(confirm.calls[0].channelFact.channelTransactionId, 'ch-1');
  assert.equal(view.status, 'unpaid', 'fake confirm 不改订单，返回本地视图');
});

test('刷新语义：unknown 单同样触发查单；已支付单不查（R7）', async () => {
  const unknown = build({ order: makeOrder('unpaid'), payment: makePayment('unknown') });
  await unknown.useCase.execute({ orderId: ORDER, userId: USER });
  assert.deepEqual(unknown.channel.queries, [ORDER]);

  const paid = build({ order: makeOrder('paid'), payment: makePayment('succeeded') });
  await paid.useCase.execute({ orderId: ORDER, userId: USER });
  assert.deepEqual(paid.channel.queries, [], '支付已完成不再查渠道');
});

test('刷新语义：渠道查询失败仍返回本地视图（不阻断刷新）', async () => {
  const { useCase, confirm } = build({ order: makeOrder('unpaid'), payment: makePayment('processing'), channelResult: new Error('渠道超时') });
  const view = await useCase.execute({ orderId: ORDER, userId: USER });
  assert.equal(confirm.calls.length, 0);
  assert.equal(view.id, ORDER);
});
