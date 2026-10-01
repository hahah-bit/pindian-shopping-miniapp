import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let allocateQuantity;
let wholeQuantityToGrams;
let toMinimalUnits;
let formatQuantity;
try {
  ({ allocateQuantity, wholeQuantityToGrams, toMinimalUnits, formatQuantity } = require('../../../backend/dist/contexts/fulfillment/domain/quantity-allocation.js'));
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


// ---- R01 单位注册表（独立审查：10 克组被分配 5000 克） ----

test('R01 单位注册表：重量单位按克换算（斤/千克/克/两）', () => {
  assert.deepEqual(toMinimalUnits('10', '斤'), { units: 5000, kind: 'weight' });
  assert.deepEqual(toMinimalUnits('2.5', '斤'), { units: 1250, kind: 'weight' });
  assert.deepEqual(toMinimalUnits('10', '克'), { units: 10, kind: 'weight' });
  assert.deepEqual(toMinimalUnits('1', '千克'), { units: 1000, kind: 'weight' });
  assert.deepEqual(toMinimalUnits('0.5', 'kg'), { units: 500, kind: 'weight' });
  assert.deepEqual(toMinimalUnits('4', '两'), { units: 200, kind: 'weight' });
});

test('R01 单位注册表：计数单位按整件；小数数量不可履约', () => {
  assert.deepEqual(toMinimalUnits('10', '个'), { units: 10, kind: 'countable' });
  assert.deepEqual(toMinimalUnits('3', '箱'), { units: 3, kind: 'countable' });
  assert.equal(toMinimalUnits('2.5', '个'), null, '0.5 个无法履约');
});

test('R01 单位注册表：未知单位拒绝；非整数克重量拒绝；非法文本拒绝', () => {
  assert.equal(toMinimalUnits('10', '升'), null, '未知单位生成时拒绝并留痕');
  assert.equal(toMinimalUnits('0.001', '斤'), null, '0.5g 非整数克');
  assert.equal(toMinimalUnits('abc', '斤'), null);
  assert.equal(toMinimalUnits('0', '克'), null);
});

test('R01 展示换算：formatQuantity 回原单位（斤 3 位小数；克整数；计数整数）', () => {
  assert.equal(formatQuantity(5000, '斤'), '10.000');
  assert.equal(formatQuantity(1667, '斤'), '3.334');
  assert.equal(formatQuantity(10, '克'), '10');
  assert.equal(formatQuantity(4, '个'), '4');
});

test('R01 端到端分配：10 克组两笔 30 份额 → [5,5]（修复审查探针缺陷）', () => {
  const result = allocateQuantity(10, [{ orderId: 'a', units: 30 }, { orderId: 'b', units: 30 }]);
  assert.deepEqual(result.map((r) => r.grams), [5, 5]);
  assert.equal(result.reduce((s, r) => s + r.grams, 0), 10);
});
