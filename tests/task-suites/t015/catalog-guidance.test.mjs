import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {AiCatalogRead}=require('../../../backend/dist/workflows/ai-catalog-read.js');
const {aiReplyResult}=require('../../../backend/dist/contexts/customer-service/domain/product-guidance.js');
const {ApplicationError}=require('../../../backend/dist/shared/kernel.js');

test('F053 分类词查询水果零食饮品，名称无需包含分类词，未知及冲突筛选不放宽',async()=>{
 const id=randomUUID(),seen=[];
 const reader=new AiCatalogRead({list:async q=>{seen.push(q);return{items:q.keyword===''&&q.category?[{id,stockStatus:'available'}]:[],total:q.keyword===''&&q.category?1:0};},get:async()=>({id,name:'公开分类商品',description:'体验',priceFromFen:1234,stockStatus:'available'})});
 for(const [keyword,category] of [['水果','fruit'],['水果商品','fruit'],['fruit','fruit'],['零食','snack'],['零食商品','snack'],['饮品','drink'],['饮料','drink'],['其他商品','other']]){
  const cards=await reader.search({keyword,intent:'product_introduction'});assert.equal(cards.length,1,'分类词'+keyword+'应查分类而非名称');assert.equal(seen.at(-1).keyword,'');assert.equal(seen.at(-1).category,category);
 }
 assert.equal((await reader.search({keyword:'水果',category:'fruit',intent:'product_recommendation'})).length,1);
 for(const query of [{keyword:'不存在',category:'fruit'},{keyword:'水果',category:'drink'}]){
  assert.deepEqual(await reader.search({...query,intent:'product_recommendation'}),[]);assert.equal(seen.at(-1).keyword,query.keyword);assert.equal(seen.at(-1).category,query.category);
 }
});
test('F053 公开查询可用过滤、详情再核实、描述截断及两页/三条上限',async()=>{
 const ids=Array.from({length:25},()=>randomUUID()),lists=[],gets=[];
 const reader=new AiCatalogRead({list:async q=>{lists.push(q);return{items:ids.slice((q.page-1)*20,q.page*20).map(id=>({id,stockStatus:q.page===1?'sold_out':'available'})),total:25};},get:async id=>{gets.push(id);if(id===ids[20])throw new ApplicationError('NOT_FOUND','下架');return{id,name:'咖啡',description:'x'.repeat(900),priceFromFen:1234,stockStatus:id===ids[21]?'sold_out':'available'};}});
 const cards=await reader.search({keyword:' 咖啡 ',category:'drink',intent:'product_recommendation'});assert.equal(lists.length,2);assert.equal(lists[0].keyword,'咖啡');assert.equal(lists[0].category,'drink');assert.equal(gets.length,3);assert.equal(cards.length,1);assert.equal(cards[0].productId,ids[22]);assert.equal(cards[0].description.length,600);assert.equal(cards[0].imageUrl,null);assert.equal(cards[0].priceFromFen,1234);
});
test('F053 空结果/取消/畸形参数不进行宽搜索或写操作，真实查询错误不吞掉',async()=>{
 let calls=0;const reader=new AiCatalogRead({list:async()=>{calls++;return{items:[],total:0};},get:async()=>{throw Error('不应执行');}});
 assert.deepEqual(await reader.search({keyword:'不存在',intent:'product_introduction'}),[]);assert.equal(calls,1);
 for(const q of [{keyword:'x'.repeat(61),intent:'product_recommendation'},{keyword:'咖啡',intent:'general'},{keyword:'咖啡',intent:'product_recommendation',category:'private'},{keyword:'咖啡',intent:'product_recommendation',sql:'DELETE'}])await assert.rejects(()=>reader.search(q),e=>e.code==='VALIDATION_FAILED');
 const c=new AbortController();c.abort();await assert.rejects(()=>reader.search({keyword:'咖啡',intent:'product_recommendation'},c.signal),e=>e.code==='AI_TIMEOUT');assert.equal(calls,1);
 const broken=new AiCatalogRead({list:async()=>{throw Error('DB failure');},get:async()=>{}});await assert.rejects(()=>broken.search({keyword:'咖啡',intent:'product_recommendation'}));
});
test('F053 结构化回复校验金额/ID/张数/一般意图，丢弃额外模型链接字段',()=>{
 const card={productId:randomUUID(),name:'咖啡',description:'体验商品',priceFromFen:1234,imageUrl:null,url:'https://evil.test'},base={text:'可查看商品',intent:'product_recommendation',recommendations:[card]};
 assert.equal(aiReplyResult(base).recommendations[0].url,undefined);
 for(const candidate of [{...base,recommendations:[{...card,priceFromFen:1.5}]},{...base,recommendations:[{...card,priceFromFen:-1}]},{...base,recommendations:[{...card,productId:'https://evil.test'}]},{...base,recommendations:[{...card,imageUrl:'javascript:evil()'}]},{...base,recommendations:[card,card]},{...base,recommendations:Array.from({length:4},()=>({...card,productId:randomUUID()}))},{...base,intent:'general'},{...base,intent:'refund_done'}])assert.throws(()=>aiReplyResult(candidate),e=>e.code==='AI_UNAVAILABLE');
});
