import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let allocateQuantity;
let wholeQuantityToGrams;
try {
  ({ allocateQuantity, wholeQuantityToGrams } = require('../../../backend/dist/contexts/fulfillment/domain/quantity-allocation.js'));
} catch {
  allocateQuantity = null;
}

const orders = (...units) => units.map((u, i) => ({ orderId: `o-${i + 1}`, units: u }));
const gramsOf = (result) => result.map((r) => r.grams);

test('整除尾差：5000g 三笔 20 份额 → 前序补齐 [1667,1667,1666]，Σ=5000', () => {
  const result = allocateQuantity(5000, orders(20, 20, 20));
  assert.deepEqual(gramsOf(result), [1667, 1667, 1666]);
  assert.equal(result.reduce((s, r) => s + r.grams, 0), 5000, '守恒');
});

test('整除无尾差：5000g 30+15+15 → [2500,1250,1250]（混合份额）', () => {
  const result = allocateQuantity(5000, orders(30, 15, 15));
  assert.deepEqual(gramsOf(result), [2500, 1250, 1250]);
});

test('单订单整组：5000g 60 份额 → [5000]', () => {
  assert.deepEqual(gramsOf(allocateQuantity(5000, orders(60))), [5000]);
});

test('1/3 不可整除小数量：1000g 三笔 20 → [334,333,333]', () => {
  const result = allocateQuantity(1000, orders(20, 20, 20));
  assert.deepEqual(gramsOf(result), [334, 333, 333]);
  assert.equal(result.reduce((s, r) => s + r.grams, 0), 1000);
});

test('五笔 12 份额：5000g → [1000×5]', () => {
  assert.deepEqual(gramsOf(allocateQuantity(5000, orders(12, 12, 12, 12, 12))), [1000, 1000, 1000, 1000, 1000]);
});

test('尾差按订单传入顺序（创建序）补齐：与输入顺序一致', () => {
  const result = allocateQuantity(1000, [{ orderId: 'z', units: 20 }, { orderId: 'a', units: 20 }, { orderId: 'b', units: 20 }]);
  assert.deepEqual(gramsOf(result), [334, 333, 333]);
  assert.deepEqual(result.map((r) => r.orderId), ['z', 'a', 'b'], '保持输入顺序输出');
});

test('守恒不变式：多组随机参数 Σ分配 = 整件克数', () => {
  const cases = [
    [5000, [30, 20, 10]],
    [1250, [30, 30]],
    [500, [15, 15, 15, 15]],
    [3750, [20, 20, 20]],
    [600, [12, 12, 12, 12, 12]]
  ];
  for (const [total, unitsList] of cases) {
    const list = unitsList.map((u, i) => ({ orderId: `c-${i}`, units: u }));
    const result = allocateQuantity(total, list);
    assert.equal(result.reduce((s, r) => s + r.grams, 0), total, `totalG=${total}`);
  }
});

test('非法输入拒绝：totalG 非正/非整数；份额和不等于 60；空订单', () => {
  assert.throws(() => allocateQuantity(0, orders(60)));
  assert.throws(() => allocateQuantity(-100, orders(60)));
  assert.throws(() => allocateQuantity(500.5, orders(60)));
  assert.throws(() => allocateQuantity(5000, orders(30, 30, 30)), /60/);
  assert.throws(() => allocateQuantity(5000, []));
});

test('wholeQuantityToGrams：斤文本转整数克；非整数克返回 null', () => {
  assert.equal(wholeQuantityToGrams('10'), 5000);
  assert.equal(wholeQuantityToGrams('2.5'), 1250);
  assert.equal(wholeQuantityToGrams('0.5'), 250);
  assert.equal(wholeQuantityToGrams('0.002'), 1);
  assert.equal(wholeQuantityToGrams('0.001'), null, '0.001 斤 = 0.5g 非整数克 → null（生成时拒绝）');
  assert.equal(wholeQuantityToGrams('abc'), null);
  assert.equal(wholeQuantityToGrams('0'), null);
});
