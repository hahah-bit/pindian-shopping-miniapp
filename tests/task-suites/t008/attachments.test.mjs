import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);let ChatMediaUseCase;
try {({ChatMediaUseCase}=require('../../../backend/dist/contexts/customer-service/application/chat-media.js'));} catch {}
test('私有图片：他人会话不能上传/读取，外会话附件不能发送，真格式检查必须执行',async()=>{
  assert.equal(typeof ChatMediaUseCase,'function');let inspected=0;let asset;
  const usecase=new ChatMediaUseCase({conversations:{findById:async id=>({state:{conversationId:id,userId:'owner',assignedAgentId:'agent',status:'active'},isOpen:true,canRead:a=>a==='agent',isAssignedTo:a=>a==='agent'})},images:{insert:async a=>asset=a,findById:async()=>asset},inspector:{inspect:b=>{inspected++;if(!b?.length)throw Object.assign(new Error('非法图'),{code:'VALIDATION_FAILED'});return {format:'png',width:100,height:100};}},clock:{now:()=>new Date()}});
  await assert.rejects(()=>usecase.upload({conversationId:'c',userId:'other',buffer:Buffer.from('img')}),e=>e.code==='NOT_FOUND');
  const image=await usecase.upload({conversationId:'c',userId:'owner',buffer:Buffer.from('img')});assert.equal(inspected,1);
  await assert.rejects(()=>usecase.read({id:image.id,userId:'other'}),e=>e.code==='NOT_FOUND');
  assert.equal((await usecase.read({id:image.id,userId:'owner'})).buffer.toString(),'img');
  await assert.rejects(()=>usecase.assertAttachment('other-c',image.id),e=>e.code==='NOT_FOUND');
});
