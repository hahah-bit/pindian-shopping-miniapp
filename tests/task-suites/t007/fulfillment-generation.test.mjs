import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let FulfillmentGenerationTask;
let FulfillmentOrder;
try {
  FulfillmentGenerationTask = require('../../../backend/dist/workflows/fulfillment-generation.task.js').FulfillmentGenerationTask;
  FulfillmentOrder = require('../../../backend/dist/contexts/fulfillment/domain/fulfillment-order.js').FulfillmentOrder;
} catch {
  FulfillmentGenerationTask = null;
}

const NOW = new Date('2026-10-03T00:00:00Z');
const GROUP = 'eeeeeeee-4444-4444-8444-444444444444';

class InlineRunner { async run(w) { return w({ tx: 1 }); } }

/** 扫描 fake：insert 后把组从"未生成"清单移除（模拟 NOT EXISTS 查询语义）。 */
class FakeGroups {
  constructor(ids) { this.pending = [...ids]; this.snapshots = { [GROUP]: { wholeQuantityText: '10', unit: '斤' } }; }
  async listSuccessGroupIdsWithoutFulfillment() { return [...this.pending]; }
  async findGroupSnapshot(id) {
    const s = this.snapshots[id];
    return s ? { groupId: id, wholeQuantityText: s.wholeQuantityText, unit: s.unit } : null;
  }
  markGenerated(id) { this.pending = this.pending.filter((g) => g !== id); }
}

class FakeOrders {
  constructor(byGroup) { this.byGroup = byGroup; }
  async listPaidByGroup(groupId) { return this.byGroup[groupId] ?? []; }
}

class FakeRepo {
  constructor(opts = {}) { this.inserted = []; this.failOn = opts.failOn ?? null; this.failError = opts.failError; }
  async insert(order) {
    if (this.failOn && order.state.orderId === this.failOn) throw this.failError;
    this.inserted.push(order);
  }
}

function build({ groupIds = [GROUP], ordersByGroup, repoOpts = {}, groups } = {}) {
  const groupsRepo = groups ?? new FakeGroups(groupIds);
  const ordersRepo = new FakeOrders(ordersByGroup);
  const repo = new FakeRepo(repoOpts);
  // scan 端口 = 组扫描（listSuccess/findGroupSnapshot）+ 组内 paid 订单（listPaidByGroup）
  const scan = Object.assign(Object.create(groupsRepo), { listPaidByGroup: ordersRepo.listPaidByGroup.bind(ordersRepo) });
  const task = new FulfillmentGenerationTask({
    scan,
    fulfillmentOrders: repo,
    runner: new InlineRunner(),
    clock: { now: () => NOW }
  });
  return { task, groupsRepo, repo };
}

const paidOrders = [
  { orderId: 'o-1', userId: 'u-1', units: 20, address: { receiver_name: '张三', phone: '13800001234', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园 1 号' } },
  { orderId: 'o-2', userId: 'u-2', units: 20, address: { receiver_name: '李四', phone: '13900005678', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园 2 号' } },
  { orderId: 'o-3', userId: 'u-3', units: 20, address: { receiver_name: '王五', phone: '13700009012', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园 3 号' } }
];

test('生成：成功组为每笔 paid 订单生成履约单，分配 [1667,1667,1666]g，收货快照来自订单地址', async () => {
  const { task, repo } = build({ ordersByGroup: { [GROUP]: paidOrders } });
  const groups = await task.execute({ limit: 10 });
  assert.equal(groups, 1, '生成 1 个组');
  assert.equal(repo.inserted.length, 3);
  const grams = repo.inserted.map((f) => f.state.allocatedQuantityGrams);
  assert.deepEqual(grams, [1667, 1667, 1666], 'D011 前序补齐');
  assert.equal(repo.inserted.reduce((s, f) => s + f.state.allocatedQuantityGrams, 0), 5000, '守恒');
  assert.equal(repo.inserted[0].state.status, 'pending_shipment');
  assert.equal(repo.inserted[0].state.unit, '斤');
  assert.equal(repo.inserted[0].state.receiver.name, '张三');
  assert.equal(repo.inserted[0].state.receiver.phone, '13800001234');
  assert.equal(repo.inserted[0].state.receiver.version, 1);
  assert.deepEqual(repo.inserted.map((f) => f.state.orderId), ['o-1', 'o-2', 'o-3'], '按订单创建序分配');
});

test('幂等：已生成组不再出现在扫描清单，第二轮零生成', async () => {
  const groupsRepo = new FakeGroups([GROUP]);
  const { task, repo } = build({ groups: groupsRepo, ordersByGroup: { [GROUP]: paidOrders } });
  await task.execute({ limit: 10 });
  groupsRepo.markGenerated(GROUP);
  const second = await task.execute({ limit: 10 });
  assert.equal(second, 0);
  assert.equal(repo.inserted.length, 3, '不重复生成');
});

test('配置错误跳过：整件数量无法换算整数克 → 该组跳过不崩溃，继续处理后续组', async () => {
  const groupsRepo = new FakeGroups(['gggggggg-4444-4444-8444-444444444001', 'gggggggg-4444-4444-8444-444444444002']);
  groupsRepo.snapshots['gggggggg-4444-4444-8444-444444444001'] = { wholeQuantityText: '0.001', unit: '斤' };
  groupsRepo.snapshots['gggggggg-4444-4444-8444-444444444002'] = { wholeQuantityText: '2.5', unit: '斤' };
  const ordersByGroup = {
    'gggggggg-4444-4444-8444-444444444001': paidOrders,
    'gggggggg-4444-4444-8444-444444444002': paidOrders
  };
  const { task, repo } = build({ groups: groupsRepo, ordersByGroup });
  const groups = await task.execute({ limit: 10 });
  assert.equal(groups, 1, '仅第二组成功');
  assert.equal(repo.inserted.length, 3);
  assert.deepEqual(repo.inserted.map((f) => f.state.allocatedQuantityGrams), [417, 417, 416], '2.5 斤=1250g 三单前序补齐');
});

test('并发唯一冲突（23505）视为已生成，不崩溃', async () => {
  const err = new Error('duplicate key'); (err).code = '23505';
  const { task, repo } = build({ ordersByGroup: { [GROUP]: paidOrders }, repoOpts: { failOn: 'o-2', failError: err } });
  const groups = await task.execute({ limit: 10 });
  assert.equal(groups, 1, '23505 视为幂等成功');
  // InlineRunner 无回滚语义：异常中止后续插入；真实回滚原子性由 t007 集成（真实 PG）验证
  assert.equal(repo.inserted.length, 1);
});

test('其他插入失败：该组不计成功，异常不向上扩散（下一轮重试，原子性由真实 PG 集成验证）', async () => {
  const err = new Error('db down');
  const { task, repo } = build({ ordersByGroup: { [GROUP]: paidOrders }, repoOpts: { failOn: 'o-2', failError: err } });
  const groups = await task.execute({ limit: 10 });
  assert.equal(groups, 0, '失败组不计入');
  assert.equal(repo.inserted.length, 1);
});


test('R01 单位：10 克组两笔 30 份额 → [5,5] 合计 10 克', async () => {
  const groupsRepo = new FakeGroups(['gggggggg-4444-4444-8444-444444444003']);
  groupsRepo.snapshots['gggggggg-4444-4444-8444-444444444003'] = { wholeQuantityText: '10', unit: '克' };
  const twoOrders = paidOrders.slice(0, 2).map((o) => ({ ...o, units: 30 }));
  const { task, repo } = build({ groups: groupsRepo, ordersByGroup: { 'gggggggg-4444-4444-8444-444444444003': twoOrders } });
  const groups = await task.execute({ limit: 10 });
  assert.equal(groups, 1);
  assert.deepEqual(repo.inserted.map((f) => f.state.allocatedQuantityGrams), [5, 5]);
  assert.equal(repo.inserted.reduce((s, f) => s + f.state.allocatedQuantityGrams, 0), 10, '合计 10 克');
  assert.equal(repo.inserted[0].state.unit, '克');
});

test('R01 单位：计数单位 10 个三笔 20 份额 → [4,3,3] 整件', async () => {
  const groupsRepo = new FakeGroups(['gggggggg-4444-4444-8444-444444444004']);
  groupsRepo.snapshots['gggggggg-4444-4444-8444-444444444004'] = { wholeQuantityText: '10', unit: '个' };
  const { task, repo } = build({ groups: groupsRepo, ordersByGroup: { 'gggggggg-4444-4444-8444-444444444004': paidOrders } });
  await task.execute({ limit: 10 });
  assert.deepEqual(repo.inserted.map((f) => f.state.allocatedQuantityGrams), [4, 3, 3]);
});

test('R01 单位：未知单位组跳过（不静默换算、不阻塞其他组）', async () => {
  const groupsRepo = new FakeGroups(['gggggggg-4444-4444-8444-444444444005']);
  groupsRepo.snapshots['gggggggg-4444-4444-8444-444444444005'] = { wholeQuantityText: '10', unit: '升' };
  const { task, repo } = build({ groups: groupsRepo, ordersByGroup: { 'gggggggg-4444-4444-8444-444444444005': paidOrders } });
  const groups = await task.execute({ limit: 10 });
  assert.equal(groups, 0, '未知单位拒绝生成');
  assert.equal(repo.inserted.length, 0);
});


// ---- 2026-10-02 复验 P1：计数商品零分配（总量 < 订单数）→ 拒绝生成 + 留痕 ----

test('计数零分配：1 个 × 两笔 30 份额 → 整组拒绝生成（不部分生成、不超发）', async () => {
  const groupsRepo = new FakeGroups(['gggggggg-4444-4444-8444-444444444006']);
  groupsRepo.snapshots['gggggggg-4444-4444-8444-444444444006'] = { wholeQuantityText: '1', unit: '个' };
  const twoOrders = paidOrders.slice(0, 2).map((o) => ({ ...o, units: 30 }));
  const { task, repo } = build({ groups: groupsRepo, ordersByGroup: { 'gggggggg-4444-4444-8444-444444444006': twoOrders } });
  const groups = await task.execute({ limit: 10 });
  assert.equal(groups, 0, '零分配组整组拒绝');
  assert.equal(repo.inserted.length, 0, '不部分生成（不静默删除用户履约）');
  // 已有成功组不受影响（无删除动作）——由真实 PG 集成验证整组恢复
});
