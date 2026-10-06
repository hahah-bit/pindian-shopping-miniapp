import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {AiSupportService}=require('../../../backend/dist/contexts/customer-service/application/ai-support/service.js');
function setup({configured=true,reply=async()=> '你好，请在我的页面管理地址。',timeoutMs=200}={}){
 const rows=[];let calls=0;
 const repo={claim:async({userId,clientMessageId,text,now})=>{
  const duplicate=rows.find(x=>x.userId===userId&&x.clientMessageId===clientMessageId);
  if(duplicate&&duplicate.text!==text)throw Object.assign(Error(),{code:'IDEMPOTENCY_CONFLICT'});
  if(duplicate?.status==='completed')return{turn:duplicate,replayed:true};
  const turn=duplicate??{id:randomUUID(),userId,clientMessageId,text,reply:null,createdAt:now};turn.status='pending';turn.leaseId=randomUUID();if(!duplicate)rows.push(turn);return{turn,replayed:false};
 },list:async userId=>({items:rows.filter(x=>x.userId===userId),nextBefore:null}),finish:async(u,id,leaseId,reply)=>{const row=rows.find(x=>x.userId===u&&x.id===id&&x.leaseId===leaseId);if(!row)return false;row.reply=reply;row.status=reply===null?'failed':'completed';return true;}};
 const model={configured,reply:async input=>{calls++;return reply(input);}};
 return{service:new AiSupportService({repository:repo,model,timeoutMs}),rows,calls:()=>calls};
}
test('F051 登录与输入边界，未配置不创建消息',async()=>{
 const s=setup();await assert.rejects(()=>s.service.send('',{text:'你好',clientMessageId:randomUUID()}),e=>e.code==='UNAUTHENTICATED');
 for(const body of [null,[],{text:'',clientMessageId:randomUUID()},{text:'x'.repeat(1001),clientMessageId:randomUUID()},{text:'你好',clientMessageId:'bad'}])await assert.rejects(()=>s.service.send(randomUUID(),body),e=>e.code==='VALIDATION_FAILED');
 const off=setup({configured:false});await assert.rejects(()=>off.service.send(randomUUID(),{text:'你好',clientMessageId:randomUUID()}),e=>e.code==='AI_NOT_CONFIGURED');assert.equal(off.rows.length,0);
});
test('F051 同键重复重放、异文拒绝，同键跨用户独立',async()=>{
 const s=setup(),user=randomUUID(),key=randomUUID();const a=await s.service.send(user,{text:'你好',clientMessageId:key});
 const b=await s.service.send(user,{text:'你好',clientMessageId:key});assert.equal(b.replayed,true);assert.equal(a.turn.id,b.turn.id);assert.equal(s.calls(),1);
 await assert.rejects(()=>s.service.send(user,{text:'修改文本',clientMessageId:key}),e=>e.code==='IDEMPOTENCY_CONFLICT');
 await s.service.send(randomUUID(),{text:'你好',clientMessageId:key});assert.equal(s.rows.length,2);
});
test('F051 模型失败/超时不伪造回复，同键可安全重试',async()=>{
 const s=setup({reply:async()=>{throw Error('upstream secret');}}),user=randomUUID(),body={text:'你好',clientMessageId:randomUUID()};
 await assert.rejects(()=>s.service.send(user,body),e=>e.code==='AI_UNAVAILABLE'&&!e.message.includes('secret'));assert.equal(s.rows[0].status,'failed');
 const slow=setup({timeoutMs:10,reply:async()=>new Promise(()=>{})});await assert.rejects(()=>slow.service.send(user,body),e=>e.code==='AI_TIMEOUT');assert.equal(slow.rows[0].status,'failed');
});
test('F051 上下文只包含本人成功轮次，手机号脱敏',async()=>{
 let input;const s=setup({reply:async v=>{input=v;return '可以';}}),alice=randomUUID(),bob=randomUUID();
 await s.service.send(bob,{text:'Bob秘密',clientMessageId:randomUUID()});await s.service.send(alice,{text:'手机号13800000001',clientMessageId:randomUUID()});
 assert.ok(!input.text.includes('13800000001'));await s.service.send(alice,{text:'怎么改地址',clientMessageId:randomUUID()});
 assert.ok(input.history.every(x=>!x.text.includes('Bob')&&!x.text.includes('13800000001')));
});
