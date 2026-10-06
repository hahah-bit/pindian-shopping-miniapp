import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {localStack,product} from '../../helpers/local-stack.mjs';
import {modelServer,toolChoice,textChoice} from '../../helpers/ai-model.mjs';
import {miniHarness} from '../../helpers/mini-page/harness.mjs';
const require=createRequire(import.meta.url);
const {PostgresAiSupportRepository}=require('../../../backend/dist/contexts/customer-service/adapters/outbound/postgres/ai-support-repository.js');
test('F053 真实HTTP/PG/Pi导购：公开商品、意图、持久重放、本人隔离与页面详情入口',async t=>{
 const m=await modelServer(t,p=>{
  const last=p.messages.at(-1);if(last.role==='tool'){const result=JSON.parse(last.content);return textChoice(result.products.length?'可以看看'+result.products.map(x=>x.name).join('、')+'，点击商品查看详情。':'没有匹配商品，请到商品页搜索。');}
  const question=JSON.stringify(last.content);return question.includes('地址')?textChoice('进入我的页面添加地址。'):toolChoice({intent:question.includes('介绍')?'product_introduction':'product_recommendation',keyword:question.includes('不存在')?'不存在':'咖啡',category:'drink'});
 });
 const s=await localStack(t,'t015',{extraEnv:{AI_SUPPORT_API_KEY:'test-only',AI_SUPPORT_BASE_URL:m.url,AI_SUPPORT_MODEL:'support-test'}});
 const a=await s.login('alice'),b=await s.login('bob');
 const one=await product(s,{name:'鲜烘咖啡豆',category:'drink',description:'只作本地体验，不含产地或口味认证',originalPriceFen:3499});
 const two=await product(s,{name:'袋装咖啡',category:'drink'});
 const off=await product(s,{name:'下架咖啡秘密商品',category:'drink'});await s.http('/admin/v1/products/'+off.id+'/unpublish',{token:s.superToken,method:'POST'});
 const sold=await product(s,{name:'售罄咖啡秘密商品',category:'drink'});await s.http('/admin/v1/products/'+sold.id+'/stock-adjustments',{token:s.superToken,method:'POST',body:{setTo:0,reason:'隔离导购验证',requestId:randomUUID()}});
 await s.http('/admin/v1/products',{token:s.superToken,method:'POST',status:201,body:{name:'草稿咖啡秘密商品',category:'drink',originalPriceFen:1000,wholeQuantity:'10',unit:'斤',allowedShareUnits:[30],initialStockWholeItems:1}});
 const key=randomUUID(),path='/mini/v1/ai-support/messages',body={text:'有推荐的咖啡么？',clientMessageId:key,recommendations:[{productId:off.id,url:'https://evil.test'}]};
 const initial=await s.http(path,{token:a.token,method:'POST',body});assert.equal(initial.turn.intent,'product_recommendation');assert.equal(initial.turn.recommendations.length,2);assert.ok(initial.turn.recommendations.every(c=>[one.id,two.id].includes(c.productId)&&!('url'in c)));
 assert.equal(JSON.stringify(m.requests).includes('秘密商品'),false);assert.equal(initial.turn.status,'completed');
 const catalog=await s.http('/mini/v1/products/'+one.id);assert.equal(initial.turn.recommendations.find(c=>c.productId===one.id).priceFromFen,catalog.priceFromFen);
 const calls=m.requests.length;const replay=await s.http(path,{token:a.token,method:'POST',body});assert.equal(replay.replayed,true);assert.deepEqual(replay.turn.recommendations,initial.turn.recommendations);assert.equal(m.requests.length,calls);
 const rebuilt=new PostgresAiSupportRepository(s.db);assert.deepEqual((await rebuilt.list(a.user.id,20)).items[0].recommendations,initial.turn.recommendations);
 assert.deepEqual((await s.http(path,{token:b.token})).items,[]);await s.http(path+'?before='+initial.turn.id,{token:b.token,status:404});
 const h=miniHarness(s);t.after(()=>h.close());h.storage.set('pindian_user_token',a.token);const page=h.page('features/ai-support/pages/chat/index.ts');await page.load();assert.equal(page.data.messages[0].cards.length,2);page.openProduct({currentTarget:{dataset:{productId:one.id}}});assert.equal(h.events.at(-1).url,'/features/catalog/pages/detail/index?id='+one.id);
 const detail=h.page('features/catalog/pages/detail/index.ts');detail.onLoad({id:one.id});await h.idle();assert.equal(detail.data.id,one.id);assert.equal(detail.data.name,one.name);assert.equal(detail.data.error,'');
 const introduced=await s.http(path,{token:a.token,method:'POST',body:{text:'介绍咖啡商品',clientMessageId:randomUUID()}});assert.equal(introduced.turn.intent,'product_introduction');assert.ok(JSON.stringify(m.requests.at(-2)).includes('已展示商品名称'));
 const none=await s.http(path,{token:a.token,method:'POST',body:{text:'介绍不存在商品',clientMessageId:randomUUID()}});assert.deepEqual(none.turn.recommendations,[]);
 const normal=await s.http(path,{token:a.token,method:'POST',body:{text:'地址怎么填？',clientMessageId:randomUUID()}});assert.equal(normal.turn.intent,'general');assert.deepEqual(normal.turn.recommendations,[]);
 await s.http('/admin/v1/products/'+one.id+'/unpublish',{token:s.superToken,method:'POST'});await s.http('/mini/v1/products/'+one.id,{status:404});await page.load();assert.equal(page.data.messages.find(x=>x.id===initial.turn.id).cards.length,2,'历史展示快照不重写');
 const more=await s.http(path+'?pageSize=1',{token:a.token});assert.ok(more.nextBefore);assert.equal((await s.http(path+'?pageSize=1&before='+more.nextBefore,{token:a.token})).items.length,1);
 assert.equal(Number((await s.db.query('SELECT count(*) AS n FROM orders')).rows[0].n),0);
});
test('F053 PG同租约原子写文本及卡片，旧执行/失败清理/数据库张数约束',async t=>{
 const s=await localStack(t,'t015'),a=await s.login('alice'),r=new PostgresAiSupportRepository(s.db),now=new Date();
 const input={userId:a.user.id,text:'推荐咖啡',clientMessageId:randomUUID(),now,leaseUntil:new Date(now.getTime()+45000)};
 const old=(await r.claim(input)).turn,later=new Date(now.getTime()+46000),current=(await r.claim({...input,now:later,leaseUntil:new Date(later.getTime()+45000)})).turn;
 const card={productId:randomUUID(),name:'咖啡',description:'公开事实',imageUrl:null,priceFromFen:999};
 assert.equal(await r.finish(a.user.id,old.id,old.leaseId,'旧文本',later,{intent:'product_recommendation',recommendations:[{...card,priceFromFen:111}]}),false);
 assert.equal(await r.finish(a.user.id,current.id,current.leaseId,'新文本',later,{intent:'product_recommendation',recommendations:[card]}),true);
 const saved=(await new PostgresAiSupportRepository(s.db).list(a.user.id,20)).items[0];assert.equal(saved.reply,'新文本');assert.equal(saved.recommendations[0].priceFromFen,999);assert.equal((await r.claim({...input,now:later})).replayed,true);
 const failed=(await r.claim({...input,clientMessageId:randomUUID(),now:later})).turn;await r.finish(a.user.id,failed.id,failed.leaseId,null,later,{intent:'product_recommendation',recommendations:[card]});const retried=(await r.claim({...input,clientMessageId:failed.clientMessageId,now:later})).turn;assert.deepEqual(retried.recommendations,[]);assert.equal(retried.intent,'general');
 await assert.rejects(()=>r.finish(a.user.id,retried.id,retried.leaseId,'不合法',later,{intent:'product_recommendation',recommendations:[card,card,card,card]}),e=>e.code==='23514');
 const pending=(await r.list(a.user.id,20)).items.find(x=>x.id===retried.id);assert.equal(pending.status,'pending');assert.equal(pending.reply,null);assert.deepEqual(pending.recommendations,[]);
});
