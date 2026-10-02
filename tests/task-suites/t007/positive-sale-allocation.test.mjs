import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const quantity=require('../../../backend/dist/contexts/fulfillment/domain/quantity-allocation.js');
test('D019：3件30/15禁止销售，3件仅20可以销售，5件所有选项可以销售',()=>{
  assert.equal(typeof quantity.isPositiveSaleAllocation,'function');
  assert.equal(quantity.isPositiveSaleAllocation('3','件',[30,15]),false);
  assert.equal(quantity.isPositiveSaleAllocation('3','件',[20]),true);
  assert.equal(quantity.isPositiveSaleAllocation('5','件',[30,20,15,12]),true);
  assert.equal(quantity.isPositiveSaleAllocation('2','件',[20]),false);
  assert.equal(quantity.isPositiveSaleAllocation('3.000','件',[20]),true);
});
test('D019：有序组合必须穷举，不能仅检查总件数大于等于人数',()=>{
  assert.equal(typeof quantity.isPositiveSaleAllocation,'function');
  assert.deepEqual(quantity.allocateQuantity(3,[{orderId:'a',units:30},{orderId:'b',units:15},{orderId:'c',units:15}]).map(a=>a.grams),[2,1,0]);
  assert.equal(quantity.isPositiveSaleAllocation('3','件',[30,15]),false);
  assert.equal(quantity.isPositiveSaleAllocation('1.001','kg',[30,20,15,12]),true);
  assert.equal(quantity.isPositiveSaleAllocation('1','未知',[30]),false);
});
test('D019：历史3件30/15/15暂停履约并持久化异常，不产生半组履约',async()=>{
  const {FulfillmentGenerationTask}=require('../../../backend/dist/workflows/fulfillment-generation.task.js');let blocked=null;let inserted=0;
  const scan={listSuccessGroupIdsWithoutFulfillment:async()=>['group'],findGroupSnapshot:async()=>({wholeQuantityText:'3',unit:'件'}),listPaidByGroup:async()=>[30,15,15].map((units,i)=>({orderId:String(i),units,userId:'user',address:{}})),recordBlocked:async(id,reason)=>blocked={id,reason}};
  const task=new FulfillmentGenerationTask({scan,fulfillmentOrders:{insert:async()=>inserted++},runner:{run:async f=>f({})},clock:{now:()=>new Date()}});
  assert.equal(await task.execute({}),0);assert.equal(inserted,0);assert.equal(blocked?.reason,'ZERO_ALLOCATION');
});
