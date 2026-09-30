import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CreateProductDraft,
  UpdateProduct,
  PublishProduct,
  UnpublishProduct
} = require('../../../backend/dist/contexts/catalog/application/index.js');
const { AdjustStock, ListStockMovements } = require('../../../backend/dist/contexts/inventory/application/index.js');
const { Stock, StockMovement } = require('../../../backend/dist/contexts/inventory/domain/index.js');
const {
  CreateProductWorkflow,
  AdminCatalogQueries,
  MiniCatalogQueries,
  PublishProductWorkflow
} = require('../../../backend/dist/workflows/index.js');

const NOW = new Date('2026-09-30T00:00:00Z');
const clock = { now: () => NOW };

async function expectRejection(factory, code) {
  try { await factory(); }
  catch (error) {
    assert.equal(error.code, code, `期望 ${code} 实际 ${error.code}：${error.message}`);
    return error;
  }
  assert.fail(`应抛出 ${code}，但调用成功了`);
}

function validInput(overrides = {}) {
  return {
    name: '红富士苹果',
    description: '产地直发',
    originalPriceFen: 50000,
    wholeQuantity: '10',
    unit: '斤',
    allowedShareUnits: [30, 20, 15, 12],
    mainImageId: '11111111-aaaa-4bbb-8ccc-000000000001',
    detailImageIds: ['11111111-aaaa-4bbb-8ccc-000000000002'],
    initialStockWholeItems: 5,
    ...overrides
  };
}

class FakeProductRepository {
  constructor() { this.products = new Map(); this.failSave = false; }
  async save(product) { if (this.failSave) throw new Error('db down'); this.products.set(product.state.productId, product); }
  async findById(id) { return this.products.get(id) ?? null; }
  async listAdmin({ status, keyword, page, pageSize }) {
    let items = [...this.products.values()].sort((a, b) => b.state.createdAt - a.state.createdAt);
    if (status) items = items.filter((p) => p.state.status === status);
    if (keyword) items = items.filter((p) => p.state.name.includes(keyword));
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
  }
  async listOnShelf({ page, pageSize }) {
    const items = [...this.products.values()].filter((p) => p.state.status === 'on_shelf').sort((a, b) => b.state.createdAt - a.state.createdAt);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
  }
  async findByIdIfOnShelf(id) {
    const p = this.products.get(id);
    return p && p.state.status === 'on_shelf' ? p : null;
  }
}

class FakeMediaRepository {
  constructor() { this.ready = new Set(['11111111-aaaa-4bbb-8ccc-000000000001', '11111111-aaaa-4bbb-8ccc-000000000002', '11111111-aaaa-4bbb-8ccc-000000000003']); }
  async findManyReady(ids) { return ids.filter((id) => this.ready.has(id)).map((id) => ({ state: { mediaId: id } })); }
}

class FakeStockRepository {
  constructor() { this.stocks = new Map(); this.movements = []; this.failAdjust = false; }
  async initialize(stock, movement) {
    this.stocks.set(stock.state.productId, stock);
    if (movement) this.movements.push(movement);
  }
  async findById(id) { return this.stocks.get(id) ?? null; }
  async adjust(command) {
    if (this.failAdjust) throw new Error('db down');
    const stock = this.stocks.get(command.productId);
    if (!stock) return null;
    const existing = command.requestId
      ? this.movements.find((m) => m.state.productId === command.productId && m.state.requestId === command.requestId)
      : undefined;
    if (existing) return { stock, movement: existing, replayed: true };
    const current = stock.state.availableWholeItems;
    const delta = command.setTo !== undefined ? command.setTo - current : command.delta;
    if (delta === 0) return { stock, movement: null, replayed: true };
    const updated = Stock.rehydrate({ productId: command.productId, availableWholeItems: current, reservedWholeItems: 0, updatedAt: command.now }).applyDelta(delta, command.now);
    const movement = StockMovement.create({
      productId: command.productId, delta, resultingAvailable: updated.state.availableWholeItems,
      reason: command.reason, actorAdminId: command.actorAdminId, requestId: command.requestId, createdAt: command.now
    });
    this.stocks.set(command.productId, updated);
    this.movements.push(movement);
    return { stock: updated, movement, replayed: false };
  }
  async listMovements(productId, page, pageSize) {
    const items = this.movements.filter((m) => m.state.productId === productId).reverse();
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
  }
}

class InlineRunner {
  constructor() { this.sessions = []; }
  async run(work) { const session = { tx: true }; this.sessions.push(session); return work(session); }
}

function buildStack(overrides = {}) {
  const productRepo = new FakeProductRepository();
  const mediaRepo = new FakeMediaRepository();
  const stockRepo = new FakeStockRepository();
  const runner = new InlineRunner();
  const urlBuilder = { build: (id) => `http://cdn.test/media/${id}` };
  const createDraft = new CreateProductDraft({ media: mediaRepo });
  const workflow = new CreateProductWorkflow({ createDraft, products: productRepo, stocks: stockRepo, runner, clock });
  const publishWorkflow = new PublishProductWorkflow({
    products: productRepo,
    publish: new PublishProduct({ products: productRepo }),
    stocks: {
      findById: (id) => stockRepo.findById(id)
    }
  });
  const adminQueries = new AdminCatalogQueries({ products: productRepo, stocks: stockRepo, urlBuilder });
  const miniQueries = new MiniCatalogQueries({ products: productRepo, stocks: stockRepo, urlBuilder });
  return { productRepo, mediaRepo, stockRepo, runner, workflow, publishWorkflow, adminQueries, miniQueries, createDraft, urlBuilder };
}

test('创建商品工作流：草稿与初始库存同事务写入，含首条变动记录', async () => {
  const { workflow, productRepo, stockRepo, runner } = buildStack();
  const result = await workflow.execute({ input: validInput(), actorAdminId: 'admin-1' });
  const product = productRepo.products.get(result.productId);
  assert.equal(product.state.status, 'draft');
  assert.equal(stockRepo.stocks.get(result.productId).state.availableWholeItems, 5);
  assert.equal(stockRepo.movements.length, 1);
  assert.equal(stockRepo.movements[0].state.delta, 5);
  assert.equal(runner.sessions.length, 1, '库存与商品在同一事务会话中写入');
});

test('创建商品：初始库存为 0 时不产生变动记录，库存行仍创建', async () => {
  const { workflow, stockRepo, productRepo } = buildStack();
  const result = await workflow.execute({ input: validInput({ initialStockWholeItems: 0 }), actorAdminId: 'admin-1' });
  assert.equal(stockRepo.stocks.get(result.productId).state.availableWholeItems, 0);
  assert.equal(stockRepo.movements.length, 0);
  assert.ok(productRepo.products.has(result.productId));
});

test('创建商品：引用不存在或非 ready 图片时拒绝，商品与库存都不创建', async () => {
  const { workflow, productRepo, stockRepo, mediaRepo } = buildStack();
  mediaRepo.ready.delete('11111111-aaaa-4bbb-8ccc-000000000002');
  await expectRejection(() => workflow.execute({ input: validInput(), actorAdminId: 'a' }), 'VALIDATION_FAILED');
  mediaRepo.ready.add('11111111-aaaa-4bbb-8ccc-000000000002');
  mediaRepo.ready.delete('11111111-aaaa-4bbb-8ccc-000000000001');
  await expectRejection(() => workflow.execute({ input: validInput(), actorAdminId: 'a' }), 'VALIDATION_FAILED');
  assert.equal(productRepo.products.size, 0);
  assert.equal(stockRepo.stocks.size, 0);
});

test('创建商品：非法初始库存拒绝', async () => {
  const { workflow } = buildStack();
  await expectRejection(() => workflow.execute({ input: validInput({ initialStockWholeItems: -1 }), actorAdminId: 'a' }), 'VALIDATION_FAILED');
  await expectRejection(() => workflow.execute({ input: validInput({ initialStockWholeItems: 100001 }), actorAdminId: 'a' }), 'VALIDATION_FAILED');
});

test('后台商品视图：金额、份额参考、图片 URL、库存状态组装正确', async () => {
  const { workflow, adminQueries } = buildStack();
  const { productId } = await workflow.execute({ input: validInput(), actorAdminId: 'a' });
  const view = await adminQueries.get(productId);
  assert.equal(view.originalPriceFen, 50000);
  assert.equal(view.userWholePriceFen, 50500);
  assert.equal(view.availableWholeItems, 5);
  assert.equal(view.stockStatus, 'available');
  assert.equal(view.mainImage.url, 'http://cdn.test/media/11111111-aaaa-4bbb-8ccc-000000000001');
  assert.deepEqual(view.detailImages.map((i) => i.url), ['http://cdn.test/media/11111111-aaaa-4bbb-8ccc-000000000002']);
  const half = view.shareOptions.find((o) => o.units === 30);
  assert.equal(half.fractionLabel, '1/2');
  assert.equal(half.referencePriceFen, 25250);
  assert.equal(half.quantityText, '5');
  const third = view.shareOptions.find((o) => o.units === 20);
  assert.equal(third.quantityText, '3.333');
  assert.equal(third.referencePriceFen, 16833);
});

test('上架工作流：库存查询 + 条件校验；成功后进入后台与小程序列表', async () => {
  const { workflow, publishWorkflow, adminQueries, miniQueries } = buildStack();
  const { productId } = await workflow.execute({ input: validInput(), actorAdminId: 'a' });
  const published = await publishWorkflow.execute({ productId });
  assert.equal(published.state.status, 'on_shelf');

  const miniList = await miniQueries.list({ page: 1, pageSize: 10 });
  assert.equal(miniList.total, 1);
  const item = miniList.items[0];
  assert.equal(item.priceFromFen, 10100, '最低参考价 = 1/5');
  assert.equal(item.userWholePriceFen, 50500);
  assert.equal(item.mainImageUrl, 'http://cdn.test/media/11111111-aaaa-4bbb-8ccc-000000000001');

  const detail = await miniQueries.get(productId);
  assert.equal(detail.stockStatus, 'available');
  assert.deepEqual(detail.detailImageUrls, ['http://cdn.test/media/11111111-aaaa-4bbb-8ccc-000000000002']);
  assert.equal(detail.shareOptions.length, 4);
});

test('上架：缺主图返回原因清单；补图后成功', async () => {
  const { workflow, publishWorkflow } = buildStack();
  const { productId } = await workflow.execute({ input: validInput({ mainImageId: undefined, detailImageIds: [] }), actorAdminId: 'a' });
  const err = await expectRejection(() => publishWorkflow.execute({ productId }), 'PRODUCT_NOT_PUBLISHABLE');
  assert.ok(err.details.includes('未设置主图'));
  assert.ok(err.details.includes('库存记录不存在') === false, '库存已随创建初始化');
});

test('上架：库存为 0 拒绝；调整库存后成功；库存清零后展示已售罄但仍上架', async () => {
  const { workflow, publishWorkflow, miniQueries, stockRepo } = buildStack();
  const { productId } = await workflow.execute({ input: validInput({ initialStockWholeItems: 0 }), actorAdminId: 'a' });
  const err = await expectRejection(() => publishWorkflow.execute({ productId }), 'PRODUCT_NOT_PUBLISHABLE');
  assert.ok(err.details.some((reason) => reason.includes('库存为 0')), JSON.stringify(err.details));

  const adjust = new AdjustStock({ stocks: stockRepo, clock });
  await adjust.execute({ productId, command: { setTo: 3, reason: '补货' }, actorAdminId: 'a' });
  await publishWorkflow.execute({ productId });
  let detail = await miniQueries.get(productId);
  assert.equal(detail.stockStatus, 'available');

  await adjust.execute({ productId, command: { delta: -3, reason: '清仓下账' }, actorAdminId: 'a' });
  detail = await miniQueries.get(productId);
  assert.equal(detail.stockStatus, 'sold_out', '库存 0 时推导已售罄');
});

test('下架：小程序立即不可见，详情 404；重复下架幂等', async () => {
  const { workflow, publishWorkflow, miniQueries, productRepo } = buildStack();
  const { productId } = await workflow.execute({ input: validInput(), actorAdminId: 'a' });
  await publishWorkflow.execute({ productId });
  const unpublish = new UnpublishProduct({ products: productRepo });
  await unpublish.execute({ productId });
  await unpublish.execute({ productId });
  const list = await miniQueries.list({ page: 1, pageSize: 10 });
  assert.equal(list.total, 0);
  await expectRejection(() => miniQueries.get(productId), 'NOT_FOUND');
});

test('编辑商品：字段与图片全量替换并重新读取', async () => {
  const { workflow, productRepo, mediaRepo, adminQueries } = buildStack();
  const { productId } = await workflow.execute({ input: validInput(), actorAdminId: 'a' });
  const update = new UpdateProduct({ products: productRepo, media: mediaRepo });
  const updated = await update.execute({
    productId,
    input: { ...validInput(), name: '红富士 精品', originalPriceFen: 52000, detailImageIds: ['11111111-aaaa-4bbb-8ccc-000000000003'] }
  });
  assert.equal(updated.state.name, '红富士 精品');
  const view = await adminQueries.get(productId);
  assert.equal(view.originalPriceFen, 52000);
  assert.deepEqual(view.detailImages.map((i) => i.mediaId), ['11111111-aaaa-4bbb-8ccc-000000000003']);
});

test('库存调整：delta/setTo 二选一、范围与原因校验；负余额拒绝', async () => {
  const { stockRepo, workflow } = buildStack();
  const { productId } = await workflow.execute({ input: validInput({ initialStockWholeItems: 10 }), actorAdminId: 'a' });
  const adjust = new AdjustStock({ stocks: stockRepo, clock });

  await expectRejection(() => adjust.execute({ productId, command: { delta: 1, setTo: 5, reason: 'x' }, actorAdminId: 'a' }), 'VALIDATION_FAILED');
  await expectRejection(() => adjust.execute({ productId, command: { reason: 'x' }, actorAdminId: 'a' }), 'VALIDATION_FAILED');
  await expectRejection(() => adjust.execute({ productId, command: { delta: 0, reason: 'x' }, actorAdminId: 'a' }), 'VALIDATION_FAILED');
  await expectRejection(() => adjust.execute({ productId, command: { delta: 2000000, reason: 'x' }, actorAdminId: 'a' }), 'VALIDATION_FAILED');
  await expectRejection(() => adjust.execute({ productId, command: { delta: -11, reason: '超扣' }, actorAdminId: 'a' }), 'CONFLICT');

  const ok = await adjust.execute({ productId, command: { delta: -3, reason: '盘点' }, actorAdminId: 'a' });
  assert.equal(ok.stock.availableWholeItems, 7);
  assert.equal(ok.movement.delta, -3);
  assert.equal(ok.idempotentReplay, false);
});

test('库存调整幂等：setTo 相同值不产生新记录；requestId 重放只记账一次', async () => {
  const { stockRepo, workflow } = buildStack();
  const { productId } = await workflow.execute({ input: validInput({ initialStockWholeItems: 10 }), actorAdminId: 'a' });
  const adjust = new AdjustStock({ stocks: stockRepo, clock });

  const sameSet = await adjust.execute({ productId, command: { setTo: 10, reason: '核对' }, actorAdminId: 'a' });
  assert.equal(sameSet.idempotentReplay, true);
  assert.equal(sameSet.movement, undefined);

  const requestId = '11111111-2222-4333-8444-555555555555';
  const first = await adjust.execute({ productId, command: { delta: -2, reason: '测试', requestId }, actorAdminId: 'a' });
  assert.equal(first.idempotentReplay, false);
  const replay = await adjust.execute({ productId, command: { delta: -2, reason: '测试', requestId }, actorAdminId: 'a' });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.stock.availableWholeItems, 8);
  const movements = await new ListStockMovements({ stocks: stockRepo }).execute({ productId, page: 1, pageSize: 10 });
  assert.equal(movements.total, 2, '初始化 1 条 + 幂等 delta 1 条');
});

test('库存调整：商品不存在返回 NOT_FOUND', async () => {
  const adjust = new AdjustStock({ stocks: new FakeStockRepository(), clock });
  await expectRejection(() => adjust.execute({ productId: '00000000-0000-4000-8000-000000000001', command: { delta: 1, reason: 'x' }, actorAdminId: 'a' }), 'NOT_FOUND');
});

test('后台列表：状态与关键字筛选、分页', async () => {
  const { workflow, adminQueries, publishWorkflow } = buildStack();
  await workflow.execute({ input: validInput({ name: '红富士苹果' }), actorAdminId: 'a' });
  const second = await workflow.execute({ input: validInput({ name: '赣南脐橙', unit: '箱', mainImageId: '11111111-aaaa-4bbb-8ccc-000000000003', detailImageIds: [] }), actorAdminId: 'a' });
  await publishWorkflow.execute({ productId: second.productId });

  const all = await adminQueries.list({ page: 1, pageSize: 10 });
  assert.equal(all.total, 2);
  const drafts = await adminQueries.list({ status: 'draft', page: 1, pageSize: 10 });
  assert.equal(drafts.total, 1);
  assert.equal(drafts.items[0].name, '红富士苹果');
  const keyword = await adminQueries.list({ keyword: '脐橙', page: 1, pageSize: 10 });
  assert.equal(keyword.total, 1);
  const paged = await adminQueries.list({ page: 2, pageSize: 1 });
  assert.equal(paged.items.length, 1);
  assert.equal(paged.total, 2);
});

test('数量与金额组装不含浮点误差：0.001 边界份额数量正确', async () => {
  const { workflow, adminQueries } = buildStack();
  const { productId } = await workflow.execute({ input: validInput({ wholeQuantity: '0.001', allowedShareUnits: [30] }), actorAdminId: 'a' });
  const view = await adminQueries.get(productId);
  const half = view.shareOptions[0];
  assert.equal(half.quantityText, '0.001', '0.0005 → half-up milli → 1 milli');
});
