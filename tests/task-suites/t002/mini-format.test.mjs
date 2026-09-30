import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// 纯字符串运算模块直接读源码（与小程序同一份逻辑），避免浮点实现漂移。
const { formatFen } = await import('../../../apps/mini-program/miniprogram/utils/format.ts');

test('formatFen：整数分转展示金额，负数与零边界正确', () => {
  assert.equal(formatFen(0), '0.00');
  assert.equal(formatFen(5), '0.05');
  assert.equal(formatFen(50500), '505.00');
  assert.equal(formatFen(10100), '101.00');
  assert.equal(formatFen(16833), '168.33');
  assert.equal(formatFen(-125), '-1.25');
  assert.equal(formatFen(99999999), '999999.99');
});
