import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let FulfillmentOrder;
let ShipFulfillmentUseCase;
let CompleteFulfillmentUseCase;
let UpdateReceiverUseCase;
let ApplicationError;
try {
  ({ FulfillmentOrder } = require('../../../backend/dist/contexts/fulfillment/domain/fulfillment-order.js'));
  ({ ShipFulfillmentUseCase, CompleteFulfillmentUseCase, UpdateReceiverUseCase } = require('../../../backend/dist/contexts/fulfillment/application/admin-fulfillment.js'));
  ({ ApplicationError } = require('../../../backend/dist/shared/kernel.js'));
} catch {
  // 模块未实现时保持 undefined，用例全部失败（红）
}

const NOW = new Date('2026-10-03T00:00:00Z');
const FID = 'aaaaaaaa-4444-4444-8444-444444444444';

class InlineRunner { async run(w) { return w({ tx: 1 }); } }

function makeFulfillment(allocated = 2500) {
  return FulfillmentOrder.create({
    fulfillmentOrderId: FID,
    groupId: 'eeeeeeee-4444-4444-8444-444444444444',
    orderId: 'bbbbbbbb-4444-4444-8444-444444444444',
    userId: 'aaaaaaaa-4444-4444-8444-444444444445',
    allocatedQuantityGrams: allocated,
    unit: '斤',
    receiver: { name: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园 1 号' },
    now: NOW
  });
}

class FakeRepo {
  constructor(order) { this.order = order; this.shipments = []; this.failTracking = null; }
  async findByIdForUpdate() { return this.order; }
  async save(o) { this.order = o; }
  async insertShipment(entity) {
    if (this.failTracking && entity.trackingNo === this.failTracking) {
      const e = new Error('dup'); (e).code = '23505'; throw e;
    }
    this.shipments.push(entity);
  }
  async listShipments() { return this.shipments; }
}

class FakeAudit {
  constructor() { this.entries = []; }
  async execute(entry) { this.entries.push(entry); }
}

function build(allocated = 2500) {
  const repo = new FakeRepo(makeFulfillment(allocated));
  const audit = new FakeAudit();
  const deps = { fulfillmentOrders: repo, runner: new InlineRunner(), clock: { now: () => NOW }, audit };
  return {
    repo, audit,
    ship: new ShipFulfillmentUseCase(deps),
    receiver: new UpdateReceiverUseCase(deps),
    complete: new CompleteFulfillmentUseCase(deps)
  };
}

test('发货：部分发货 partially_shipped → 补足 shipped（数量守恒）', async () => {
  const { ship, repo } = build(2500);
  const first = await ship.execute({ fulfillmentId: FID, quantityGrams: 2000, company: '顺丰', trackingNo: 'SF-1', isReissue: false, reason: undefined, adminId: 'admin-1', requestId: 'r1' });
  assert.equal(first.fulfillmentOrder.state.status, 'partially_shipped');
  const second = await ship.execute({ fulfillmentId: FID, quantityGrams: 500, company: '顺丰', trackingNo: 'SF-2', isReissue: false, reason: undefined, adminId: 'admin-1', requestId: 'r2' });
  assert.equal(second.fulfillmentOrder.state.status, 'shipped');
  assert.equal(repo.order.state.shippedQuantityGrams, 2500, 'Σ非补发 = 分配（守恒）');
  assert.equal(repo.shipments.length, 2);
});

test('超发拒绝：Σ非补发 + 本次 > 分配 → QUANTITY_EXCEEDS_ALLOCATION（409）', async () => {
  const { ship } = build(2500);
  await ship.execute({ fulfillmentId: FID, quantityGrams: 2000, company: '顺丰', trackingNo: 'SF-1', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r' });
  await assert.rejects(
    () => ship.execute({ fulfillmentId: FID, quantityGrams: 501, company: '顺丰', trackingNo: 'SF-2', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r' }),
    (e) => e.code === 'QUANTITY_EXCEEDS_ALLOCATION'
  );
});

test('补发：is_reissue 需原因、不计入发货进度（shipped 状态不变）', async () => {
  const { ship, repo, audit } = build(2500);
  await ship.execute({ fulfillmentId: FID, quantityGrams: 2500, company: '顺丰', trackingNo: 'SF-1', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r' });
  const reissue = await ship.execute({ fulfillmentId: FID, quantityGrams: 2500, company: '顺丰', trackingNo: 'SF-2', isReissue: true, reason: '丢件补发', adminId: 'a', requestId: 'r' });
  assert.equal(reissue.fulfillmentOrder.state.status, 'shipped', '补发不改变发货进度');
  assert.equal(repo.order.state.shippedQuantityGrams, 2500, '补发不计入 Σ');
  assert.equal(repo.shipments[1].isReissue, true);
  assert.equal(repo.shipments[1].reissueReason, '丢件补发');
  assert.ok(audit.entries.some((e) => e.action === 'fulfillment.ship'), '发货写审计');
  await assert.rejects(
    () => ship.execute({ fulfillmentId: FID, quantityGrams: 1, company: '顺丰', trackingNo: 'SF-3', isReissue: true, reason: ' ', adminId: 'a', requestId: 'r' }),
    (e) => e.code === 'VALIDATION_FAILED'
  );
});

test('重复运单：唯一冲突 23505 → SHIPMENT_DUPLICATE_TRACKING（409）', async () => {
  const { ship, repo } = build();
  repo.failTracking = 'SF-DUP';
  await assert.rejects(
    () => ship.execute({ fulfillmentId: FID, quantityGrams: 100, company: '顺丰', trackingNo: 'SF-DUP', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r' }),
    (e) => e.code === 'SHIPMENT_DUPLICATE_TRACKING'
  );
});

test('completed 后拒发；完成仅 shipped、幂等；completed_by 区分', async () => {
  const { ship, complete } = build(2500);
  await ship.execute({ fulfillmentId: FID, quantityGrams: 2500, company: '顺丰', trackingNo: 'SF-1', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r' });
  const completed = await complete.execute({ fulfillmentId: FID, by: 'admin', adminId: 'a', requestId: 'r' });
  assert.equal(completed.fulfillmentOrder.state.status, 'completed');
  assert.equal(completed.fulfillmentOrder.state.completedBy, 'admin');
  await assert.rejects(
    () => ship.execute({ fulfillmentId: FID, quantityGrams: 1, company: '顺丰', trackingNo: 'SF-9', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r' }),
    (e) => e.code === 'FULFILLMENT_NOT_SHIPPABLE'
  );
  const again = await complete.execute({ fulfillmentId: FID, by: 'admin', adminId: 'a', requestId: 'r' });
  assert.equal(again.fulfillmentOrder.state.status, 'completed', '完成幂等');
});

test('未发货完成拒绝；改址：版本递增、发货后锁定（RECEIVER_LOCKED）', async () => {
  const { ship, receiver, complete } = build(2500);
  await assert.rejects(
    () => complete.execute({ fulfillmentId: FID, by: 'admin', adminId: 'a', requestId: 'r' }),
    (e) => e.code === 'FULFILLMENT_NOT_SHIPPABLE'
  );
  const updated = await receiver.execute({ fulfillmentId: FID, receiver: { name: '李四', phone: '13900005678', province: '广东省', city: '广州市', district: '天河区', detail: '天河 2 号' }, adminId: 'a', requestId: 'r' });
  assert.equal(updated.fulfillmentOrder.state.receiver.name, '李四');
  assert.equal(updated.fulfillmentOrder.state.receiver.version, 2, '版本递增');
  await ship.execute({ fulfillmentId: FID, quantityGrams: 2500, company: '顺丰', trackingNo: 'SF-1', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r' });
  await assert.rejects(
    () => receiver.execute({ fulfillmentId: FID, receiver: { name: '王五', phone: '13700009012', province: '广东省', city: '广州市', district: '天河区', detail: 'x' }, adminId: 'a', requestId: 'r' }),
    (e) => e.code === 'RECEIVER_LOCKED'
  );
});


// ---- R06（D013 已确认）：补发不改主进度；全状态可补发；任何包裹锁地址 ----

test('R06：pending_shipment 首次操作为补发 → 状态保持待发货（主进度不变）', async () => {
  const { ship } = build(2500);
  const result = await ship.execute({ fulfillmentId: FID, quantityGrams: 100, company: '顺丰', trackingNo: 'SF-R0', isReissue: true, reason: '凭证补寄', adminId: 'a', requestId: 'r' });
  assert.equal(result.fulfillmentOrder.state.status, 'pending_shipment', '补发不得把待发货改为部分发货');
  assert.equal(result.fulfillmentOrder.state.shippedQuantityGrams, 0);
});

test('R06：completed 后补发允许且状态保持 completed', async () => {
  const { ship, complete } = build(2500);
  await ship.execute({ fulfillmentId: FID, quantityGrams: 2500, company: '顺丰', trackingNo: 'SF-1', isReissue: false, reason: undefined, adminId: 'a', requestId: 'r' });
  await complete.execute({ fulfillmentId: FID, by: 'admin', adminId: 'a', requestId: 'r' });
  const result = await ship.execute({ fulfillmentId: FID, quantityGrams: 50, company: '顺丰', trackingNo: 'SF-RC', isReissue: true, reason: '完成后丢件补寄', adminId: 'a', requestId: 'r' });
  assert.equal(result.fulfillmentOrder.state.status, 'completed', '补发不改变完成状态');
});

test('R06：仅有补发包裹也锁定地址（RECEIVER_LOCKED）', async () => {
  const { ship, receiver } = build(2500);
  await ship.execute({ fulfillmentId: FID, quantityGrams: 100, company: '顺丰', trackingNo: 'SF-R1', isReissue: true, reason: '凭证补寄', adminId: 'a', requestId: 'r' });
  await assert.rejects(
    () => receiver.execute({ fulfillmentId: FID, receiver: { name: '李四', phone: '13900005678', province: '广东省', city: '广州市', district: '天河区', detail: 'x' }, adminId: 'a', requestId: 'r' }),
    (e) => e.code === 'RECEIVER_LOCKED'
  );
});
