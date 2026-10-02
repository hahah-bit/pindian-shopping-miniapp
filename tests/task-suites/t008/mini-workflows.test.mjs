import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{createRequire}from'node:module';import{runInNewContext}from'node:vm';
const require=createRequire(import.meta.url);const ts=require('typescript');
function page(name,api){let definition;const text=readFileSync(new URL(`../../../apps/mini-program/miniprogram/features/cs/pages/${name}/index.ts`,import.meta.url),'utf8');runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},require:()=>api,Page:p=>definition=p,wx:{redirectTo:()=>{}}});return()=>Object.assign(Object.create(definition),{data:JSON.parse(JSON.stringify(definition.data)),setData(value){Object.assign(this.data,value);}});}
test('小程序工单表单每次进入生成独立键，响应丢失后保留原内容重试',async()=>{
  const calls=[];let keys=0;
  const instance=page('ticket-form',{newClientMessageId:()=>`key-${++keys}`,cardOptions:async()=>({items:[]}),createTicket:async p=>{calls.push(JSON.parse(JSON.stringify(p)));if(calls.length===1)throw new Error('响应丢失');return {ticket:{id:'ticket'}};}});
  const first=instance(),second=instance();first.onLoad();second.onLoad();assert.notEqual(first.clientTicketId,second.clientTicketId);await Promise.resolve();first.setData({title:'原标题',description:'问题描述'});await first.submit();first.setData({title:'未确认时修改内容'});await first.submit();assert.deepEqual(calls[0],calls[1]);
});
test('小程序反馈响应丢失，刷新后状态改变仍重试原反馈键与内容',async()=>{
  const calls=[];const instance=page('ticket-detail',{newClientMessageId:()=> 'feedback-key',ticketDetail:async()=>({ticket:{status:'processing'},actions:[]}),ticketFeedback:async(...p)=>{calls.push(p);if(calls.length===1)throw new Error('响应丢失');}});
  const p=instance();p.onLoad({id:'ticket'});p.setData({text:'未解决'});await p.feedback({currentTarget:{dataset:{satisfied:false}}});assert.equal(p.data.awaiting,true);await p.load();p.setData({text:'修改内容'});await p.retry();assert.equal(p.data.awaiting,false);assert.deepEqual(calls[0],calls[1]);
});
