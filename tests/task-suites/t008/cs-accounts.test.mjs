import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let ManageCsAccounts;
try{({ManageCsAccounts}=require('../../../backend/dist/contexts/identity-access/application/cs-accounts.js'));}catch{}
test('客服账号：只能创建客服角色，密码不落明文，停用同时撤销会话和审计',async()=>{
  assert.equal(typeof ManageCsAccounts,'function');let account,revoked=false,audits=[];const tx={same:true};
  const service=new ManageCsAccounts({repository:{save:async(a,t)=>{assert.equal(t,tx);account=a;},findForUpdate:async()=>account,revokeSessions:async()=>revoked=true},hasher:{hash:async()=> 'test-hash'},audit:{execute:async a=>audits.push(a)},clock:{now:()=>new Date()},runner:{run:async fn=>fn(tx)}});
  await assert.rejects(()=>service.create({username:'staff',displayName:'客服',password:'long-enough-password',role:'super_admin',actorId:'admin'}),e=>e.code==='VALIDATION_FAILED');
  const created=await service.create({username:'staff',displayName:'客服',password:'long-enough-password',role:'cs_agent',actorId:'admin'});
  assert.equal(created.role,'cs_agent');assert.equal(account.state.passwordHash,'test-hash');assert.equal(created.passwordHash,undefined);assert.equal(created.password,undefined);
  await service.status({id:created.id,status:'disabled',actorId:'admin'});assert.equal(account.state.status,'disabled');assert.equal(revoked,true);assert.equal(audits.length,2);
});
