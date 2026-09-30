import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ReserveStock, ReleaseStock, ConsumeStock } = require('../../../backend/dist/contexts/inventory/application/stock-reservation.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const NOW = new Date('2026-10-01T00:00:00Z');
const clock = { now: () => NOW };
const PRODUCT = 'aaaaaaaa-1111-4111-8111-111111111111';

class FakeStockRepository {
  constructor(initial = { available: 2, reserved: 0 }) {
    this.available = initial.available;
    this.reserved = initial.reserved;
    this.movements = [];
    this.failAdjust = null;
    this.exists = true;
  }
  async findById() {
    return this.exists ? { state: { productId: PRODUCT, availableWholeItems: this.available, reservedWholeItems: this.reserved, updatedAt: NOW } } : null;
  }
  async adjust(command) {
    if (this.failAdjust) throw this.failAdjust;
    const key = command.businessKey ?? command.requestId;
    const existing = this.movements.find((m) => m.requestId === key);
    if (existing) return { stock: { state: { productId: PRODUCT, availableWholeItems: this.available, reservedWholeItems: this.reserved, updatedAt: NOW } }, movement: existing, replayed: true };
    const delta = command.setTo !== undefined ? command.setTo - this.available : (command.delta ?? 0);
    if (delta === 0 && !command.reservedDelta) return { stock: { state: { productId: PRODUCT, availableWholeItems: this.available, reservedWholeItems: this.reserved, updatedAt: NOW } }, movement: null, replayed: true };
    this.available += delta;
    this.reserved += command.reservedDelta ?? 0;
    if (this.available < 0 || this.reserved < 0) throw new ApplicationError('CONFLICT', '负值');
    const movement = { requestId: key, delta, resultingAvailable: this.available };
    this.movements.push(movement);
    return { stock: { state: { productId: PRODUCT, availableWholeItems: this.available, reservedWholeItems: this.reserved, updatedAt: NOW } }, movement, replayed: false };
  }
  async listMovements() { return { items: this.movements, total: this.movements.length }; }
}

async function expectRejection(factory, code, message) {
  try { await factory(); }
  catch (error) {
    assert.ok(error instanceof ApplicationError, `应抛 ApplicationError，实际 ${error}`);
    assert.equal(error.code, code, `${error.code} !== ${code}: ${error.message}`);
    if (message) assert.match(error.message, message);
    return error;
  }
  assert.fail(`应抛出 ${code}，但调用成功了`);
}

test('预留：available>0 成功（available−1, reserved+1）；available=0 拒绝（AC-F14-1）', async () => {
  const repo = new FakeStockRepository({ available: 1, reserved: 0 });
  const reserve = new ReserveStock({ stocks: repo, clock });
  const result = await reserve.execute({ productId: PRODUCT, idempotencyKey: 'group-create:11111111-1111-4111-8111-111111111111' });
  assert.equal(result.available, 0);
  assert.equal(result.reserved, 1);
  await expectRejection(() => reserve.execute({ productId: PRODUCT, idempotencyKey: 'group-create:22222222-2222-4222-8222-222222222222' }), 'STOCK_INSUFFICIENT');
});

test('释放与消耗：幂等键防重复（AC-F14-3）', async () => {
  const repo = new FakeStockRepository({ available: 0, reserved: 1 });
  const release = new ReleaseStock({ stocks: repo, clock });
  const first = await release.execute({ productId: PRODUCT, idempotencyKey: 'group-release:33333333-3333-4333-8333-333333333333' });
  assert.equal(first.available, 1);
  assert.equal(first.reserved, 0);
  const replay = await release.execute({ productId: PRODUCT, idempotencyKey: 'group-release:33333333-3333-4333-8333-333333333333' });
  assert.equal(replay.available, 1, '重复释放不重复变更');
  assert.equal(replay.idempotentReplay, true);

  const repo2 = new FakeStockRepository({ available: 0, reserved: 1 });
  const consume = new ConsumeStock({ stocks: repo2, clock });
  const consumed = await consume.execute({ productId: PRODUCT, idempotencyKey: 'group-consume:44444444-4444-4444-8444-444444444444' });
  assert.equal(consumed.reserved, 0);
  assert.equal(consumed.available, 0, '消耗不动 available');
  const consumeReplay = await consume.execute({ productId: PRODUCT, idempotencyKey: 'group-consume:44444444-4444-4444-8444-444444444444' });
  assert.equal(consumeReplay.reserved, 0);
});

test('非法输入拒绝（AC-F14-5）', async () => {
  const repo = new FakeStockRepository();
  const reserve = new ReserveStock({ stocks: repo, clock });
  await expectRejection(() => reserve.execute({ productId: 'not-uuid', idempotencyKey: 'group-create:11111111-1111-4111-8111-111111111111' }), 'VALIDATION_FAILED');
  await expectRejection(() => reserve.execute({ productId: PRODUCT, idempotencyKey: '' }), 'VALIDATION_FAILED');
  await expectRejection(() => reserve.execute({ productId: PRODUCT, idempotencyKey: 'group-create:g1' }), 'VALIDATION_FAILED', /格式无效/);
  await expectRejection(() => reserve.execute({ productId: PRODUCT, idempotencyKey: 'group-create:zzzzzzzz-1111-4111-8111-111111111111' }), 'VALIDATION_FAILED');
});

test('库存行不存在返回 STOCK_INSUFFICIENT（不区分暴露内部状态）', async () => {
  const repo = new FakeStockRepository();
  repo.exists = false;
  const reserve = new ReserveStock({ stocks: repo, clock });
  await expectRejection(() => reserve.execute({ productId: PRODUCT, idempotencyKey: 'group-create:11111111-1111-4111-8111-111111111111' }), 'STOCK_INSUFFICIENT');
});
