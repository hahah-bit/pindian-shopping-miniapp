import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Conversation } = require('../../../backend/dist/contexts/customer-service/domain/conversation.js');
const { AppendMessageUseCase, ListMessagesUseCase } = require('../../../backend/dist/contexts/customer-service/application/conversation-usecases.js');
const { ConvertConversationToTicketUseCase } = require('../../../backend/dist/contexts/after-sales/application/ticket-coordination.js');
const { CreateTicketUseCase, ProcessTicketUseCase } = require('../../../backend/dist/contexts/after-sales/application/ticket-usecases.js');
const { Ticket } = require('../../../backend/dist/contexts/after-sales/domain/ticket.js');
const now = new Date('2026-10-02T00:00:00Z');
const user = 'aaaaaaaa-6666-4666-8666-000000000001';
const agent = 'dddddddd-6666-4666-8666-000000000001';
const id = 'cccccccc-6666-4666-8666-000000000001';
const runner = { run: async fn => fn({ tx: true }) };
function setup(status='active') {
  let conversation = Conversation.create({conversationId:id,userId:user,now,status,assignedAgentId:agent});
  const messages=[];
  const repo={
    findById:async()=>conversation,findByIdForUpdate:async()=>conversation,
    save:async c=>{conversation=c;},insertMessage:async m=>messages.push(m),
    findDuplicate:async(cid,key,sender,actorId)=>messages.find(m=>m.clientMessageId===key && (typeof sender!=='string'||m.sender===sender&&m.actorId===actorId))??null
  };
  return {repo,messages,append:new AppendMessageUseCase({conversations:repo,runner,clock:{now:()=>now}})};
}
test('审查 R01：撞用客服内部备注消息键不会泄露，用户不能发送备注',async()=>{
  const {append,messages}=setup();
  await append.execute({conversationId:id,agentId:agent,sender:'agent',kind:'note',content:{text:'不能泄露'},clientMessageId:'same'});
  const result=await append.execute({conversationId:id,userId:user,sender:'user',kind:'text',content:{text:'你好'},clientMessageId:'same'});
  assert.equal(result.message.content.text,'你好');assert.equal(result.message.internal,false);assert.equal(messages.length,2);
  await assert.rejects(()=>append.execute({conversationId:id,userId:user,sender:'user',kind:'note',content:{text:'伪造备注'},clientMessageId:'bad'}),e=>e.code==='VALIDATION_FAILED');
});
test('审查 R01：同发送者同键不同内容必须冲突，不能假装发送成功',async()=>{
  const {append}=setup();const input={conversationId:id,userId:user,sender:'user',kind:'text',content:{text:'原文'},clientMessageId:'retry'};
  await append.execute(input);assert.equal((await append.execute(input)).duplicated,true);
  await assert.rejects(()=>append.execute({...input,content:{text:'另一条'}}),e=>e.code==='MESSAGE_ID_CONFLICT');
});
test('审查 R07：筛选内部备注先于分页，结束会话负责客服可读',async()=>{
  const {repo}=setup('ended');
  const all=[...Array.from({length:50},(_,i)=>({seq:i+1,internal:true})),{seq:51,internal:false}];
  const usecase=new ListMessagesUseCase({conversations:repo,listMessages:async(_,after,limit,includeInternal)=>all.filter(m=>m.seq>after&&(includeInternal||!m.internal)).slice(0,limit)});
  const page=await usecase.execute({conversationId:id,userId:user,afterSeq:0,limit:50});
  assert.equal(page.messages[0]?.seq,51);assert.equal(page.nextSeq,51);
  const history=await usecase.execute({conversationId:id,agentId:agent,includeInternal:true});assert.equal(history.messages.length,50);
});
test('审查 R02：非负责客服不得将他人会话转工单',async()=>{
  const {repo}=setup();let inserts=0;
  const usecase=new ConvertConversationToTicketUseCase({conversations:repo,tickets:{insert:async()=>inserts++,insertAction:async()=>{}},runner,clock:{now:()=>now}});
  await assert.rejects(()=>usecase.execute({conversationId:id,agentId:'other',type:'other',title:'标题',description:'内容'}),e=>e.code==='NOT_FOUND');assert.equal(inserts,0);
});
test('审查 R02：不能给他人订单创建工单',async()=>{
  let inserts=0;
  const usecase=new CreateTicketUseCase({tickets:{insert:async()=>inserts++,insertAction:async()=>{}},references:{assertOwned:async()=>{throw Object.assign(new Error('他人订单'),{code:'NOT_FOUND'});}},runner,clock:{now:()=>now}});
  await assert.rejects(()=>usecase.execute({userId:user,type:'other',title:'标题',description:'内容',orderId:id}),e=>e.code==='NOT_FOUND');assert.equal(inserts,0);
});
test('审查 R05：受理后可重复回复，不满意反馈回到处理中，解决后可以关闭',async()=>{
  let ticket=Ticket.create({userId:user,type:'other',title:'标题',description:'内容',now});const actions=[];
  const usecase=new ProcessTicketUseCase({tickets:{findByIdForUpdate:async()=>ticket,save:async t=>ticket=t,insertAction:async(_,a)=>actions.push(a)},runner,clock:{now:()=>now}});
  const execute=(action,detail={})=>usecase.execute({ticketId:ticket.state.ticketId,action,adminId:agent,userId:action==='user_feedback'?user:undefined,detail});
  await execute('accept');await execute('reply',{text:'第一次'});await execute('reply',{text:'第二次'});
  await execute('resolve',{reply:'已处理'});await execute('user_feedback',{satisfied:false,text:'未解决'});assert.equal(ticket.state.status,'processing');
  await execute('resolve',{reply:'再次处理'});await execute('close',{reason:'处理完成'});assert.equal(ticket.state.status,'closed');assert.equal(actions.filter(a=>a.action==='reply').length,2);
});
test('审查 R06：转接目标必须是在线且有权限的客服',async()=>{
  const {TransferConversationUseCase}=require('../../../backend/dist/contexts/customer-service/application/agent-usecases.js');
  const {repo}=setup();const usecase=new TransferConversationUseCase({conversations:repo,presence:{isEligible:async()=>false},runner,clock:{now:()=>now}});
  await assert.rejects(()=>usecase.execute({conversationId:id,agentId:agent,targetAgentId:user}),e=>e.code==='AGENT_NOT_ONLINE');
});
test('审查 R03：退款公开端口与工单必须共用事务，订单必须是工单关联单',async()=>{
  const {RequestTicketRefundUseCase}=require('../../../backend/dist/contexts/after-sales/application/ticket-coordination.js');
  let ticket=Ticket.create({userId:user,type:'refund_issue',title:'退款',description:'内容',relatedOrderId:id,now,status:'processing'});let checked;
  const tx={transaction:'same'};const port={checkRefundable:async(input,actualTx)=>{assert.equal(actualTx,tx);checked=input;return {refundable:true};},createFullRefund:async(input,actualTx)=>{assert.equal(actualTx,tx);return {refundId:agent};}};
  const usecase=new RequestTicketRefundUseCase({tickets:{findByIdForUpdate:async()=>ticket,save:async t=>ticket=t,insertAction:async()=>{}},refundPort:port,runner:{run:async f=>f(tx)},clock:{now:()=>now}});
  await assert.rejects(()=>usecase.execute({ticketId:ticket.state.ticketId,orderId:user,adminId:agent}),e=>e.code==='NOT_FOUND');
  await usecase.execute({ticketId:ticket.state.ticketId,orderId:id,adminId:agent});assert.equal(checked.userId,user);
});
test('工单请求反馈有独立等待状态，用户答复可以重新进入处理',async()=>{
  let ticket=Ticket.create({userId:user,type:'other',title:'标题',description:'内容',now});
  const usecase=new ProcessTicketUseCase({tickets:{findByIdForUpdate:async()=>ticket,save:async t=>ticket=t,insertAction:async()=>{}},runner,clock:{now:()=>now}});
  await usecase.execute({ticketId:ticket.state.ticketId,action:'accept',adminId:agent});
  await usecase.execute({ticketId:ticket.state.ticketId,action:'request_feedback',adminId:agent,detail:{text:'请确认处理结果'}});assert.equal(ticket.state.status,'waiting_feedback');
  await usecase.execute({ticketId:ticket.state.ticketId,action:'user_feedback',userId:user,detail:{satisfied:false}});assert.equal(ticket.state.status,'processing');
});
test('工单处理审计不能被省略：审计异常向外传播以便事务回滚',async()=>{
  const ticket=Ticket.create({userId:user,type:'other',title:'标题',description:'内容',now});
  const service=new ProcessTicketUseCase({tickets:{findByIdForUpdate:async()=>ticket,save:async()=>{},insertAction:async()=>{}},runner,clock:{now:()=>now},audit:{execute:async()=>{throw new Error('审计写入故障');}}});
  await assert.rejects(()=>service.execute({ticketId:ticket.state.ticketId,action:'accept',adminId:agent}),/审计写入故障/);
});
test('工单动作重试保持同键一次，反馈改变状态后仍可恢复原请求',async()=>{
  let ticket=Ticket.create({userId:user,type:'other',title:'标题',description:'内容',now,status:'waiting_feedback'});const saved=new Map();let audits=0;
  const service=new ProcessTicketUseCase({tickets:{findByIdForUpdate:async()=>ticket,save:async t=>ticket=t,findActionByClientKey:async(_,type,actor,key)=>saved.get(`${type}:${actor}:${key}`)??null,insertAction:async(_,a,tx,key)=>{if(key)saved.set(`${a.actorType}:${a.actorId}:${key}`,a);}},runner,clock:{now:()=>now},audit:{execute:async()=>audits++}});
  const input={ticketId:ticket.state.ticketId,action:'user_feedback',userId:user,detail:{satisfied:false,text:'未解决'},clientActionId:'feedback-retry'};
  await service.execute(input);assert.equal(ticket.state.status,'processing');await service.execute(input);assert.equal(saved.size,1);assert.equal(audits,0);
  await assert.rejects(()=>service.execute({...input,detail:{satisfied:true}}),e=>e.code==='IDEMPOTENCY_CONFLICT');
});
test('消息幂等忽略 JSON 对象字段顺序，卡片重试兼容 PostgreSQL jsonb',async()=>{
  const {repo,messages}=setup();const service=new AppendMessageUseCase({conversations:repo,authorizeCard:async()=>({}),runner,clock:{now:()=>now}});
  const input={conversationId:id,userId:user,sender:'user',kind:'card',content:{cardKind:'order',cardRefId:id},clientMessageId:'card-retry'};
  await service.execute(input);messages[0].content={cardRefId:id,cardKind:'order'};assert.equal((await service.execute(input)).duplicated,true);assert.equal(messages.length,1);
});
