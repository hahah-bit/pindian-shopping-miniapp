import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SERVICE_FEE_FEN,
  referenceSharePriceFen,
  userWholePriceFen,
  shareQuantityMilli,
  Quantity,
  normalizeShareUnits,
  Product,
  MediaAsset,
  MEDIA_LIMITS
} = require('../../../backend/dist/contexts/catalog/domain/index.js');
const { Stock, StockMovement } = require('../../../backend/dist/contexts/inventory/domain/index.js');
const { ApplicationError } = require('../../../backend/dist/shared/kernel.js');

const now = new Date('2026-09-30T00:00:00Z');
const M1 = '11111111-aaaa-4bbb-8ccc-000000000001';
const D1 = '11111111-aaaa-4bbb-8ccc-000000000002';
const D2 = '11111111-aaaa-4bbb-8ccc-000000000003';
const D3 = '11111111-aaaa-4bbb-8ccc-000000000004';
const M2 = '11111111-aaaa-4bbb-8ccc-000000000005';

function validProductInput(overrides = {}) {
  return {
    name: '红富士苹果',
    description: '产地直发',
    originalPriceFen: 50000,
    wholeQuantity: '10',
    unit: '斤',
    allowedShareUnits: [30, 20, 15, 12],
    ...overrides
  };
}

test('参考价：原价 50000 分时四个份额的参考价精确；half-up 通用正确', () => {
  assert.equal(SERVICE_FEE_FEN, 500);
  assert.equal(userWholePriceFen(50000), 50500);
  assert.equal(referenceSharePriceFen(50000, 30), 25250);
  assert.equal(referenceSharePriceFen(50000, 20), 16833, '(50500*20+30)/60=16833.83 → 16833');
  assert.equal(referenceSharePriceFen(50000, 15), 12625);
  assert.equal(referenceSharePriceFen(50000, 12), 10100);
  // half-up 边界：恰好 .5 时进位。50500*15/60=12625 整除；构造 x.5：p*u/60 = 100.5 → p*u=6030 → p=201,u=30
  assert.equal(referenceSharePriceFen(201, 30), Math.floor((201 + 500) * 30 / 60 + 0.5));
  // 最低参考价
  const prices = [30, 20, 15, 12].map((u) => referenceSharePriceFen(50000, u));
  assert.equal(Math.min(...prices), 10100);
});

test('参考价：非整除与极小金额矩阵（half-up 到分）', () => {
  // 原价 1 分：user=501；501*30/60=250.5→251、501*20/60=167 整、501*15/60=125.25→125、501*12/60=100.2→100
  assert.equal(referenceSharePriceFen(1, 30), 251);
  assert.equal(referenceSharePriceFen(1, 20), 167);
  assert.equal(referenceSharePriceFen(1, 15), 125);
  assert.equal(referenceSharePriceFen(1, 12), 100);
  // 原价 99999999（上限）
  const whole = userWholePriceFen(99999999);
  assert.equal(referenceSharePriceFen(99999999, 30), Math.floor((whole * 30 + 30) / 60));
});

test('份额数量：10 斤各份额为 5/3.333/2.5/2；3 位小数边界与尾零修剪', () => {
  const ten = Quantity.parse('10');
  assert.equal(shareQuantityMilli(ten.milli, 30), 5000);
  assert.equal(shareQuantityMilli(ten.milli, 20), 3333, '10000*20/60=3333.33 → 3333');
  assert.equal(shareQuantityMilli(ten.milli, 15), 2500);
  assert.equal(shareQuantityMilli(ten.milli, 12), 2000);
  const milli = Quantity.parse('0.001').milli;
  assert.equal(milli, 1);
  assert.equal(shareQuantityMilli(milli, 30), 1, '0.5 → half-up → 1');
  assert.equal(Quantity.parse('2.500').text, '2.5');
  assert.equal(Quantity.parse('10').text, '10');
});

test('数量值对象：非法输入拒绝，合法边界通过', () => {
  for (const bad of ['0', '0.000', '-1', '1.1234', 'abc', '', '1234567890', '1.', '.5', '1e3', ' 1']) {
    assert.throws(() => Quantity.parse(bad), ApplicationError, `应拒绝 ${JSON.stringify(bad)}`);
  }
  assert.equal(Quantity.parse('999999999').milli, 999999999000);
  assert.equal(Quantity.parse('0.001').milli, 1);
});

test('份额选项：仅允许 30/20/15/12 的非空子集，规范化输出按固定顺序', () => {
  assert.deepEqual(normalizeShareUnits([12, 30, 20]), [30, 20, 12]);
  assert.deepEqual(normalizeShareUnits(['30', 15]), [30, 15]);
  for (const bad of [[], [7], [30, 60], '30', null, [30, 30.5]]) {
    assert.throws(() => normalizeShareUnits(bad), ApplicationError, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test('商品创建：字段校验与图片关联约束', () => {
  const product = Product.create({ ...validProductInput(), productId: 'p1', now });
  assert.equal(product.state.status, 'draft');
  assert.deepEqual(product.state.allowedShareUnits, [30, 20, 15, 12]);

  assert.throws(() => Product.create({ ...validProductInput(), name: '' }), ApplicationError);
  assert.throws(() => Product.create({ ...validProductInput(), name: 'x'.repeat(61) }), ApplicationError);
  assert.throws(() => Product.create({ ...validProductInput(), description: 'y'.repeat(2001) }), ApplicationError);
  assert.throws(() => Product.create({ ...validProductInput(), originalPriceFen: 0 }), ApplicationError);
  assert.throws(() => Product.create({ ...validProductInput(), originalPriceFen: 100000000 }), ApplicationError);
  assert.throws(() => Product.create({ ...validProductInput(), wholeQuantity: '0' }), ApplicationError);
  assert.throws(() => Product.create({ ...validProductInput(), unit: '' }), ApplicationError);
  assert.throws(() => Product.create({ ...validProductInput(), allowedShareUnits: [30, 31] }), ApplicationError);

  const withImages = Product.create({
    ...validProductInput(),
    mainImageId: M1,
    detailImageIds: [D1, D2],
    productId: 'p2',
    now
  });
  assert.equal(withImages.mainImage.mediaId, M1);
  assert.deepEqual(withImages.state.images.filter((i) => i.role === 'detail').map((i) => i.mediaId), [D1, D2]);

  assert.throws(() => Product.create({
    ...validProductInput(),
    detailImageIds: Array.from({ length: 10 }, (_, i) => `22222222-aaaa-4bbb-8ccc-${String(i).padStart(12, '0')}`)
  }), /9/);
  assert.throws(() => Product.create({ ...validProductInput(), detailImageIds: [D1, D1] }), ApplicationError);
  assert.throws(() => Product.create({ ...validProductInput(), mainImageId: M1, detailImageIds: [M1] }), ApplicationError);
});

test('上架条件：缺主图、库存缺失、库存为 0 分别给出原因清单；条件满足才迁移', () => {
  const noImage = Product.create({ ...validProductInput(), productId: 'a', now });
  assert.deepEqual(noImage.publishEligibilityReasons(5), ['未设置主图']);
  const withImage = Product.create({ ...validProductInput(), mainImageId: M1, productId: 'b', now });
  assert.deepEqual(withImage.publishEligibilityReasons(null), ['库存记录不存在']);
  assert.deepEqual(withImage.publishEligibilityReasons(0), ['库存为 0，补充库存后才能上架']);

  const ready = Product.create({ ...validProductInput(), mainImageId: M1, productId: 'c', now });
  const published = ready.publish(3, now);
  assert.equal(published.state.status, 'on_shelf');
  assert.equal(published.publish(3, now).state.status, 'on_shelf', '重复上架幂等');

  const err = assert_Throws(() => ready.publish(0, now));
  assert.equal(err.code, 'PRODUCT_NOT_PUBLISHABLE');
  assert.deepEqual(err.details, ['库存为 0，补充库存后才能上架']);
});

test('商品状态迁移：下架与重新上架；草稿直接下架为幂等不变', () => {
  const draft = Product.create({ ...validProductInput(), mainImageId: M1, productId: 'd', now });
  assert.equal(draft.unpublish(now).state.status, 'draft');
  const onShelf = draft.publish(1, now);
  const off = onShelf.unpublish(now);
  assert.equal(off.state.status, 'off_shelf');
  assert.equal(off.unpublish(now).state.status, 'off_shelf', '重复下架幂等');
  assert.equal(off.publish(1, now).state.status, 'on_shelf', '重新上架');
});

test('商品编辑：全量替换字段与图片；不能改成非法值', () => {
  const product = Product.create({ ...validProductInput(), mainImageId: M1, detailImageIds: [D1], productId: 'e', now });
  const updated = product.update({
    name: '红富士苹果 精选',
    description: '新描述',
    originalPriceFen: 52000,
    wholeQuantity: '9.5',
    unit: '斤',
    allowedShareUnits: [30, 20],
    mainImageId: M2,
    detailImageIds: [D1, D3]
  }, new Date('2026-09-30T01:00:00Z'));
  assert.equal(updated.state.name, '红富士苹果 精选');
  assert.equal(updated.state.originalPriceFen, 52000);
  assert.equal(updated.state.wholeQuantityText, '9.5');
  assert.deepEqual(updated.state.allowedShareUnits, [30, 20]);
  assert.equal(updated.mainImage.mediaId, M2);
  assert.deepEqual(updated.state.images.filter((i) => i.role === 'detail').map((i) => i.mediaId), [D1, D3]);
  assert.ok(updated.state.updatedAt > product.state.updatedAt);
  assert.equal(product.state.name, '红富士苹果', '原聚合不可变');
  assert.throws(() => product.update({ ...validProductInput(), originalPriceFen: -1 }, now), ApplicationError);
});

test('图片资源：创建校验尺寸/大小边界；ready 不可变，仅能标记删除', () => {
  const base = { storageKey: 'products/2026/33333333-aaaa-4bbb-8ccc-000000000010.png', format: 'png', sha256: 'f'.repeat(64), uploadedBy: 'admin1', createdAt: now };
  const asset = MediaAsset.create({ ...base, sizeBytes: 1024, width: 800, height: 600 });
  assert.equal(asset.state.status, 'ready');
  assert.throws(() => MediaAsset.create({ ...base, sizeBytes: 0, width: 800, height: 600 }), ApplicationError);
  assert.throws(() => MediaAsset.create({ ...base, sizeBytes: MEDIA_LIMITS.maxBytes + 1, width: 800, height: 600 }), ApplicationError);
  assert.throws(() => MediaAsset.create({ ...base, sizeBytes: 1024, width: 59, height: 600 }), ApplicationError);
  assert.throws(() => MediaAsset.create({ ...base, sizeBytes: 1024, width: 800, height: 6001 }), ApplicationError);
  assert.equal(MediaAsset.create({ ...base, sizeBytes: 1024, width: 60, height: 6000 }).state.width, 60);
  const deleted = asset.markDeleted(new Date('2026-09-30T02:00:00Z'));
  assert.equal(deleted.state.status, 'deleted');
  assert.ok(deleted.state.deletedAt);
});

test('库存聚合：初始化与调整的整数边界；负余额拒绝', () => {
  const stock = Stock.initialize('p1', 10, now);
  assert.equal(stock.state.availableWholeItems, 10);
  assert.equal(stock.state.reservedWholeItems, 0);
  assert.throws(() => Stock.initialize('p1', -1, now), ApplicationError);
  assert.throws(() => Stock.initialize('p1', 100001, now), ApplicationError);
  assert.equal(Stock.rehydrate({ productId: 'p1', availableWholeItems: 10, reservedWholeItems: 0, updatedAt: now }).applyDelta(-3, now).state.availableWholeItems, 7);
  assert.throws(() => Stock.rehydrate({ productId: 'p1', availableWholeItems: 2, reservedWholeItems: 0, updatedAt: now }).applyDelta(-3, now), (e) => e.code === 'CONFLICT');
});

test('库存变动：delta 非零、原因必填、长度限制', () => {
  const ok = StockMovement.create({ productId: 'p1', delta: -3, resultingAvailable: 7, reason: '盘点更正', actorAdminId: 'a1', createdAt: now });
  assert.equal(ok.state.delta, -3);
  assert.throws(() => StockMovement.create({ productId: 'p1', delta: 0, resultingAvailable: 7, reason: 'x', actorAdminId: 'a1', createdAt: now }), ApplicationError);
  assert.throws(() => StockMovement.create({ productId: 'p1', delta: 1, resultingAvailable: 8, reason: '  ', actorAdminId: 'a1', createdAt: now }), ApplicationError);
  assert.throws(() => StockMovement.create({ productId: 'p1', delta: 1, resultingAvailable: 8, reason: 'r'.repeat(201), actorAdminId: 'a1', createdAt: now }), ApplicationError);
});

function assert_Throws(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail('应抛出异常');
}
