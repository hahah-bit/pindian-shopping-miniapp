import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Product } = require('../../../backend/dist/contexts/catalog/domain/product.js');
const { MiniCatalogQueries } = require('../../../backend/dist/workflows/catalog-queries.js');
const base = { name:'苹果', originalPriceFen:3000, wholeQuantity:'10', unit:'斤', allowedShareUnits:[30,20,15,12], now:new Date() };
test('F049 分类受限且旧商品默认 other', () => {
  assert.equal(Product.create(base).state.category,'other');
  assert.equal(Product.create({...base,category:'fruit'}).state.category,'fruit');
  assert.throws(()=>Product.create({...base,category:'arbitrary'}),e=>e.code==='VALIDATION_FAILED');
});

test('F049 用户商品描述不泄露演示导入技术标识',async()=>{
 const product=Product.create({...base,description:'清爽苹果\n[demo-catalog-v1:apple]'});
 const q=new MiniCatalogQueries({products:{findByIdIfOnShelf:async()=>product},stocks:{findById:async()=>null},urlBuilder:{}});
 const dto=await q.get(product.state.productId);assert.equal(dto.description,'清爽苹果');
});
test('F049 公开查询验证关键字/分类后向存储传递组合，不截断过滤结果',async()=>{
  let observed;
  const q = new MiniCatalogQueries({products:{listOnShelf:async v=>{observed=v;return{items:[],total:12};}},stocks:{},urlBuilder:{}});
  const page=await q.list({keyword:'  苹果  ',category:'fruit',page:'2',pageSize:'5'});
  assert.deepEqual(observed,{keyword:'苹果',category:'fruit',page:2,pageSize:5});
  assert.equal(page.total,12);
  await assert.rejects(()=>q.list({keyword:'a'.repeat(61)}),e=>e.code==='VALIDATION_FAILED');
  await assert.rejects(()=>q.list({category:'invalid'}),e=>e.code==='VALIDATION_FAILED');
});
