import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {localStack} from '../../helpers/local-stack.mjs';
import {miniHarness} from '../../helpers/mini-page/harness.mjs';
const require=createRequire(import.meta.url);
const {PostgresAiSupportRepository}=require('../../../backend/dist/contexts/customer-service/adapters/outbound/postgres/ai-support-repository.js');

async function modelServer(t){
 const requests=[];const server=createServer(async(req,res)=>{
  let body='';for await(const b of req)body+=b;const payload=JSON.parse(body);requests.push(payload);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const reply='打开“我的”，进入收货地址，确认省市区后保存。';
  for(const part of [{role:'assistant',content:''},{content:reply}])res.write('data: '+JSON.stringify({id:'test-'+requests.length,object:'chat.completion.chunk',created:1,model:'support-test',choices:[{index:0,delta:part,finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'support-test',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 return{requests,url:'http://127.0.0.1:'+server.address().port+'/v1'};
}
test('F051 真实HTTP/PG/Pi内核：鉴权、重放、跨用户隔离、无工具、页面发送与历史',async t=>{
 const model=await modelServer(t);const s=await localStack(t,'t013',{extraEnv:{AI_SUPPORT_API_KEY:'test-local-only',AI_SUPPORT_BASE_URL:model.url,AI_SUPPORT_MODEL:'support-test'}});
 const a=await s.login('alice'),b=await s.login('bob');const path='/mini/v1/ai-support/messages';
 await s.http(path,{status:401});await s.http(path,{token:s.superToken,status:401});
 await s.http(path,{token:a.token,method:'POST',body:{text:'',clientMessageId:randomUUID()},status:400});
 const id=randomUUID(),body={text:'我的手机号13800001234，怎么填地址？',clientMessageId:id};
 const first=await s.http(path,{token:a.token,method:'POST',body});assert.equal(first.turn.status,'completed');assert.equal(model.requests.length,1);
 assert.equal(JSON.stringify(model.requests[0]).includes('13800001234'),false);assert.ok(!model.requests[0].tools?.length);
 const replay=await s.http(path,{token:a.token,method:'POST',body});assert.equal(replay.turn.id,first.turn.id);assert.equal(model.requests.length,1);
 await s.http(path,{token:a.token,method:'POST',body:{...body,text:'换内容'},status:409});
 assert.equal((await s.http(path,{token:b.token})).items.length,0);
 await s.http(path+'?before='+first.turn.id,{token:b.token,status:404});
 await s.http(path,{token:b.token,method:'POST',body:{text:'Bob自己的问题',clientMessageId:id}});
 assert.equal(JSON.stringify(model.requests[1]).includes('手机号'),false,'不向Bob传Alice上下文');
 const h=miniHarness(s);t.after(()=>h.close());h.storage.set('pindian_user_token',a.token);
 const page=h.page('features/ai-support/pages/chat/index.ts');await page.load();assert.equal(page.data.messages.length,1);
 page.input({detail:{value:'怎么参与拼单？'}});await page.send();await h.idle();assert.equal(page.data.messages.length,2);assert.equal(page.data.messages[1].status,'completed');assert.equal(page.data.draft,'');
 const persisted=await s.http(path,{token:a.token});assert.equal(persisted.items.length,2);
 h.failures.add('/ai-support/messages');page.input({detail:{value:'失败后重试的消息'}});await page.send();assert.equal(page.data.messages.at(-1).status,'failed');const failedKey=page.data.messages.at(-1).clientMessageId;
 h.failures.clear();await page.retryTurn({currentTarget:{dataset:{id:failedKey}}});await h.idle();assert.equal(page.data.messages.at(-1).status,'completed');assert.equal((await s.http(path,{token:a.token})).items.filter(x=>x.clientMessageId===failedKey).length,1);
 const older=await s.http(path+'?pageSize=1',{token:a.token});assert.ok(older.nextBefore);assert.equal((await s.http(path+'?pageSize=1&before='+older.nextBefore,{token:a.token})).items.length,1);
 const other=miniHarness(s);t.after(()=>other.close());other.storage.set('pindian_user_token',b.token);const bp=other.page('features/ai-support/pages/chat/index.ts');await bp.load();assert.equal(bp.data.messages.length,1);assert.equal(bp.data.messages[0].text,'Bob自己的问题');
});
test('F051 PG竞争：一人仅一租约、超时恢复不被旧执行覆盖、失败重试和持久限流',async t=>{
 const s=await localStack(t,'t013');const a=await s.login('alice');const r=new PostgresAiSupportRepository(s.db),now=new Date();
 const input={userId:a.user.id,text:'地址怎么填',clientMessageId:randomUUID(),now,leaseUntil:new Date(now.getTime()+45000)};
 const races=await Promise.allSettled([r.claim(input),r.claim({...input,clientMessageId:randomUUID()})]);assert.equal(races.filter(x=>x.status==='fulfilled').length,1);assert.equal(races.find(x=>x.status==='rejected').reason.code,'AI_BUSY');
 const first=races.find(x=>x.status==='fulfilled').value.turn;
 const later=new Date(now.getTime()+46000);const recovered=await r.claim({...input,clientMessageId:first.clientMessageId,now:later,leaseUntil:new Date(later.getTime()+45000)});
 assert.notEqual(recovered.turn.leaseId,first.leaseId);assert.equal(await r.finish(a.user.id,first.id,first.leaseId,'旧答案',later),false);
 assert.equal(await r.finish(a.user.id,first.id,recovered.turn.leaseId,null,later),true);
 const retry=await new PostgresAiSupportRepository(s.db).claim({...input,clientMessageId:first.clientMessageId,now:later});assert.equal(retry.turn.id,first.id);
 await r.finish(a.user.id,first.id,retry.turn.leaseId,'恢复答案',later);
 for(let i=0;i<7;i++){const v=await r.claim({...input,clientMessageId:randomUUID(),now:later});await r.finish(a.user.id,v.turn.id,v.turn.leaseId,'答案',later);}
 await assert.rejects(()=>r.claim({...input,clientMessageId:randomUUID(),now:later}),e=>e.code==='RATE_LIMITED');
 const after=new Date(now.getTime()+61000);const next=await r.claim({...input,clientMessageId:randomUUID(),now:after});await r.finish(a.user.id,next.turn.id,next.turn.leaseId,'新窗口',after);
 const all=await r.list(a.user.id,50);assert.equal(all.items.length,9);const p1=await r.list(a.user.id,4);const p2=await r.list(a.user.id,4,p1.nextBefore);const p3=await r.list(a.user.id,4,p2.nextBefore);assert.equal(new Set([...p1.items,...p2.items,...p3.items].map(x=>x.id)).size,9);
});
