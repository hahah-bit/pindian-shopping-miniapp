import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCompletenessTable, canJoinGroup, remainingCapacity } = require('../../../backend/dist/contexts/group-buying/domain/completeness.js');

/** 穷举：units 能否由 allowed 集合（可重复使用）精确凑出。 */
function bruteForceCompletable(allowed, target) {
  if (target === 0) return true;
  const stack = [0];
  const seen = new Set([0]);
  while (stack.length) {
    const current = stack.pop();
    for (const unit of allowed) {
      const next = current + unit;
      if (next === target) return true;
      if (next < target && !seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

const ALL_ALLOWED = [[30], [20], [15], [12], [30, 20], [30, 15], [30, 12], [20, 15], [20, 12], [15, 12], [30, 20, 15], [30, 20, 12], [30, 15, 12], [20, 15, 12], [30, 20, 15, 12]];

test('可完成性 DP 与穷举对拍：15 种允许集合 × 0..60 全表一致（G1）', () => {
  for (const allowed of ALL_ALLOWED) {
    const table = buildCompletenessTable(allowed);
    for (let target = 0; target <= 60; target++) {
      assert.equal(table[target], bruteForceCompletable(allowed, target), `allowed=${JSON.stringify(allowed)} target=${target}`);
    }
  }
});

test('可完成性：非法输入拒绝（空集合、非 60 单位制数值）', () => {
  assert.throws(() => buildCompletenessTable([]), Error);
  assert.throws(() => buildCompletenessTable([10]), Error);
  assert.throws(() => buildCompletenessTable([30, 20.5]), Error);
});

test('不可完成余量不被接受（G2 采样，穷举对拍为准）', () => {
  // {30}：剩 20/15/12 均不可完成
  const only = buildCompletenessTable([30]);
  for (const rest of [10, 12, 15, 20, 25]) assert.equal(only[rest], false, `{30} 剩 ${rest} 应不可完成`);
  // {20,15}：10/25/5 不可完成；35=20+15、55=20+20+15 可行
  const mf = buildCompletenessTable([20, 15]);
  assert.equal(mf[10], false);
  assert.equal(mf[25], false);
  assert.equal(mf[5], false);
  assert.equal(mf[35], true, '20+15=35');
  assert.equal(mf[55], true, '20+20+15=55');
  // {20,15,12}：15+15=30 可行
  const mixed = buildCompletenessTable([20, 15, 12]);
  assert.equal(mixed[30], true, '15+15=30');
  assert.equal(mixed[10], false);
  // 混合组合：1/3+1/3+1/4+? 剩 10 不可完成 → 62 超容本就不允许；50=20+15+15 或 20+20+? → true
  assert.equal(mixed[50], true, '20+15+15=50');
});

test('canJoinGroup：组满/单位非法/超容/加入后不可完成均拒绝（G2）', () => {
  const table = buildCompletenessTable([30, 20, 15, 12]);
  assert.equal(canJoinGroup([30, 20, 15, 12], table, 0, 30), false, '组满不可加入');
  assert.equal(canJoinGroup([30, 20, 15, 12], table, 40, 10), false, '单位不在允许集合');
  assert.equal(canJoinGroup([30, 20, 15, 12], table, 10, 30), false, '单位大于剩余');
  assert.equal(canJoinGroup([30], buildCompletenessTable([30]), 30, 30), true, '恰好填满');
  // {20,15} 组剩 10：任何合法单位（20/15）都超容 → false
  const mfTable = buildCompletenessTable([20, 15]);
  assert.equal(canJoinGroup([20, 15], mfTable, 10, 15), false);
  assert.equal(canJoinGroup([20, 15], mfTable, 10, 20), false);
  // {20,15} 剩 30：买 20 后剩 10 不可完成 → 拒绝；买 15 后剩 15 可完成 → 接受
  assert.equal(canJoinGroup([20, 15], mfTable, 30, 20), false, '加入后剩 10 不可完成');
  assert.equal(canJoinGroup([20, 15], mfTable, 30, 15), true, '加入后剩 15 可完成');
});

test('剩余容量计算：paid + reserved 扣减，边界 0 与 60', () => {
  assert.equal(remainingCapacity(0, 0), 60);
  assert.equal(remainingCapacity(30, 20), 10);
  assert.equal(remainingCapacity(60, 0), 0);
  assert.throws(() => remainingCapacity(40, 30), Error, '超容非法');
  assert.throws(() => remainingCapacity(-1, 0), Error);
});
