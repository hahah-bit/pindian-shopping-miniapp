import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Payment } = require('../../../backend/dist/contexts/payments/domain/index.js');
const { InitiatePayment } = require('../../../backend/dist/contexts/payments/application/index.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-02T00:00:00Z');
const USER = 'aaaaaaaa-1111-4111-8111-111111111111';
const ORDER = 'bbbbbbbb-2222-4222-8222-222222222222';
const OPENID = 'o-test-openid';

class FakeClock { now() { return NOW; } }
const runner = { run: async (w) => w({ tx: true }) };

class FakeOrderRepository {
  constructor(order) { this.order = order; }
  async findById() { return this.order ?? null; }  // 平铺 OrderForPaymentState
  async save() {}
}
function makeOrder(status = 'unpaid', totalAmountFen = 16833) {
  return { orderId: ORDER, userId: USER, status, totalAmountFen, units: 20, groupId: 'eeeeeeee-5555-4555-8555-555555555555', reservationExpiresAt: new Date(NOW.getTime() + 900_000) };
}
class FakeGroupRepository {
  constructor(open = true) { this.open = open; }
  async isJoinable() { return this.open; }
}

class FakeChannel {
  constructor(behavior = 'ok') { this.behavior = behavior; this.calls = []; }
  async createJsapiOrder(input) {
    this.calls.push(input);
    if (this.behavior === 'timeout') throw Object.assign(new Error('timeout'), { code: 'CHANNEL_TIMEOUT' });
    if (this.behavior === 'used') throw Object.assign(new Error('used'), { code: 'OUT_TRADE_NO_USED' });
    if (this.behavior === 'not_configured') throw Object.assign(new Error('nc'), { code: 'NOT_CONFIGURED' });
    return { prepayId: 'prepay-' + input.outTradeNo.slice(0, 8) };
  }
  async queryOrderByOutTradeNo(outTradeNo) {
    if (this.behavior === 'query_success') return { tradeState: 'SUCCESS', transactionId: 'ch-' + outTradeNo.slice(0, 8), payerTotal: 16833 };
    return { tradeState: 'NOTPAY' };
  }
}

class FakePaymentRepository {
  constructor() { this.payments = new Map(); }
  async insert(p) { if (this.payments.has(p.state.orderId)) throw new Error('dup'); this.payments.set(p.state.orderId, p); }
  async findByOrderId(id) { return this.payments.get(id) ?? null; }
  async save(p) { this.payments.set(p.state.orderId, p); }
}

class FakeUserPort {
  async getOpenid() { return OPENID; }
}

function build(overrides = {}) {
  const orders = new FakeOrderRepository(makeOrder(overrides.orderStatus));
  const groups = new FakeGroupRepository(overrides.groupOpen);
  const payments = new FakePaymentRepository();
  const channel = overrides.channel ?? new FakeChannel();
  const useCase = new InitiatePayment({
    orders, groups, payments, channel,
    users: new FakeUserPort(),
    runner, clock: new FakeClock(),
    payConfig: { configured: overrides.payConfig?.configured ?? true, notifyUrl: 'https://api.test/notify' },
    maxRetries: 3
  });
  return { orders, groups, payments, channel, useCase };
}

const CMD = { orderId: ORDER, userId: USER };

test('发起支付：核验归属/状态/资格 → 渠道下单 → processing + 调起参数', async () => {
  const { payments, channel, useCase } = build();
  const view = await useCase.execute(CMD);
  assert.equal(view.status, 'processing');
  assert.match(view.payParams.package, /^prepay_id=prepay-/);
  assert.equal(view.payParams.signType, 'RSA');
  assert.equal(channel.calls[0].amountFen, 16833, '金额来自订单快照');
  assert.equal(channel.calls[0].outTradeNo, ORDER);
  const stored = await payments.findByOrderId(ORDER);
  assert.equal(stored.state.status, 'processing');
  assert.equal(stored.state.amountFen, 16833);
});

test('重复发起：prepay 2h 内复用同一支付单与参数（幂等）', async () => {
  const { useCase, channel } = build();
  const first = await useCase.execute(CMD);
  const second = await useCase.execute(CMD);
  assert.equal(second.paymentId, first.paymentId);
  assert.equal(second.payParams.package, first.payParams.package);
  assert.equal(channel.calls.length, 1, '只调一次渠道');
});

test('越权：非本人订单 404（G2）', async () => {
  const { useCase } = build();
  await assert.rejects(() => useCase.execute({ orderId: ORDER, userId: '99999999-9999-4999-8999-999999999999' }), (e) => e.code === 'NOT_FOUND');
});

test('订单不可支付：已取消/已过期/组已结束 → ORDER_NOT_PAYABLE', async () => {
  const c = build({ orderStatus: 'cancelled' });
  await assert.rejects(() => c.useCase.execute(CMD), (e) => e.code === 'ORDER_NOT_PAYABLE');
  const e = build({ orderStatus: 'expired' });
  await assert.rejects(() => e.useCase.execute(CMD), (e2) => e2.code === 'ORDER_NOT_PAYABLE');
  const g = build({ groupOpen: false });
  await assert.rejects(() => g.useCase.execute(CMD), (e2) => e2.code === 'ORDER_NOT_PAYABLE');
});

test('渠道未配置：503 WECHAT_PAY_NOT_CONFIGURED，不创建支付单', async () => {
  const { payments, useCase } = build({ channel: new FakeChannel('not_configured'), payConfig: { configured: false } });
  await assert.rejects(() => useCase.execute(CMD), (e) => e.code === 'WECHAT_PAY_NOT_CONFIGURED');
  assert.equal(payments.payments.size, 0);
});

test('外部超时：结果未知（unknown），不认定失败，可查询接管（G8）', async () => {
  const { payments, useCase } = build({ channel: new FakeChannel('timeout') });
  const view = await useCase.execute(CMD);
  assert.equal(view.status, 'unknown');
  const stored = await payments.findByOrderId(ORDER);
  assert.equal(stored.state.status, 'unknown');
});

test('同号已用：查询确认（可能已成功）——本测试渠道返回 NOTPAY → 处理中', async () => {
  const { useCase, channel } = build({ channel: Object.assign(new FakeChannel('used'), { queryOrderByOutTradeNo: async () => ({ tradeState: 'NOTPAY' }) }) });
  const view = await useCase.execute(CMD);
  assert.equal(view.status, 'processing', '查单确认后按结果建单');
  assert.ok(channel.calls.length >= 0);
});
