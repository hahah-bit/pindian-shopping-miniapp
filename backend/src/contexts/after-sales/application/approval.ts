import {isDeepStrictEqual}from'node:util';
import {ApplicationError,type Clock}from'../../../shared/kernel';
import {ActionRequest,uuidPattern}from'../domain/action-request';
import {Ticket,type TicketActionData}from'../domain/ticket';
export interface ApprovalRepository {
  lockRequester?(id:string,tx:unknown):Promise<void>;
  findByClientKey(actorId:string,key:string,tx:unknown):Promise<ActionRequest|null>;
  findByIdForUpdate(id:string,tx:unknown):Promise<ActionRequest|null>;
  insert(request:ActionRequest,tx:unknown):Promise<void>;save(request:ActionRequest,tx:unknown):Promise<void>;
  list(ticketId:string):Promise<ActionRequest[]>;
}
export interface ApprovalEffects {
  fulfillmentSummary?(orderId:string,userId:string):Promise<unknown>;
  validateRefund(input:{orderId:string;userId:string},tx:unknown):Promise<{amountFen:number}>;
  createRefund(input:{orderId:string;userId:string;adminId:string;reason:string},tx:unknown):Promise<{refundId:string}>;
  validateReshipment(input:{orderId:string;userId:string;payload:Record<string,unknown>},tx:unknown):Promise<void>;
  createReshipment(input:{orderId:string;userId:string;payload:Record<string,unknown>;adminId:string;reason:string},tx:unknown):Promise<{shipmentId:string}>;
  readAnomaly?(groupId:string,orderId:string,tx:unknown):Promise<{userId:string}>;
}
interface SubmitInput {ticketId:string;orderId:string;kind:'refund'|'reshipment';clientRequestId:string;reason:string;payload:Record<string,unknown>;actorId:string;isSupervisor?:boolean}
export class ApprovalService {
  constructor(private readonly deps:{requests:ApprovalRepository;tickets:{findByIdForUpdate(id:string,tx:unknown):Promise<Ticket|null>;findById(id:string):Promise<Ticket|null>;insert?(ticket:Ticket,tx:unknown):Promise<void>;save(ticket:Ticket,tx:unknown):Promise<void>;insertAction(id:string,action:TicketActionData,tx:unknown):Promise<void>};effects:ApprovalEffects;runner:{run<T>(work:(tx:unknown)=>Promise<T>):Promise<T>};audit:{execute(entry:Record<string,unknown>,tx:unknown):Promise<void>};clock:Clock}){}
  private async ownedTicket(id:string,actorId:string,isSupervisor:boolean,tx?:unknown){
    const t=tx?await this.deps.tickets.findByIdForUpdate(id,tx):await this.deps.tickets.findById(id);
    if(!t||(!isSupervisor&&t.state.assignedAgentId!==actorId))throw new ApplicationError('NOT_FOUND','工单未分配给您');return t;
  }
  async list(ticketId:string,actorId:string,isSupervisor:boolean){await this.ownedTicket(ticketId,actorId,isSupervisor);return this.deps.requests.list(ticketId);}
  async fulfillment(ticketId:string,actorId:string,isSupervisor:boolean){const t=await this.ownedTicket(ticketId,actorId,isSupervisor);return t.state.relatedOrderId?await this.deps.effects.fulfillmentSummary?.(t.state.relatedOrderId,t.state.userId)??null:null;}
  async submit(input:SubmitInput):Promise<{request:ActionRequest}>{
    return this.deps.runner.run(async tx=>{await this.deps.requests.lockRequester?.(input.actorId,tx);const ticket=await this.ownedTicket(input.ticketId,input.actorId,Boolean(input.isSupervisor),tx);return this.submitLocked(input,ticket,tx);});
  }
  private async submitLocked(input:SubmitInput,ticket:Ticket,tx:unknown):Promise<{request:ActionRequest}>{
    if(ticket.state.relatedOrderId!==input.orderId)throw new ApplicationError('NOT_FOUND','申请订单与工单不一致');
    const duplicate=await this.deps.requests.findByClientKey(input.actorId,input.clientRequestId,tx);
    if(duplicate){const s=duplicate.state;if(s.ticketId!==input.ticketId||s.orderId!==input.orderId||s.kind!==input.kind||s.reason!==input.reason.trim()||!isDeepStrictEqual(s.payload,input.payload))throw new ApplicationError('IDEMPOTENCY_CONFLICT','申请键已用于不同内容');return {request:duplicate};}
    if(!['processing','waiting_feedback'].includes(ticket.state.status))throw new ApplicationError('TICKET_STATE_CONFLICT','工单受理后才能申请业务处理');
    const facts=input.kind==='refund'?await this.deps.effects.validateRefund({orderId:input.orderId,userId:ticket.state.userId},tx):null;
    const request=ActionRequest.create({...input,requesterId:input.actorId,amountFen:facts?.amountFen??null,now:this.deps.clock.now()});
    if(input.kind==='reshipment')await this.deps.effects.validateReshipment({orderId:input.orderId,userId:ticket.state.userId,payload:request.state.payload},tx);
    await this.deps.requests.insert(request,tx);
    await this.deps.tickets.insertAction(ticket.state.ticketId,{action:input.kind==='refund'?'request_refund':'request_reshipment',actorType:'agent',actorId:input.actorId,detail:{requestId:request.state.id,reason:input.reason,status:'pending'},createdAt:this.deps.clock.now()},tx);
    await this.deps.audit.execute({adminId:input.actorId,action:`ticket.request_${input.kind}`,resourceType:'after_sales_request',resourceId:request.state.id,requestId:null,detail:{ticketId:input.ticketId,orderId:input.orderId}},tx);
    return {request};
  }
  async submitAnomaly(input:{groupId:string;orderId:string;actorId:string;clientRequestId:string;reason:string}):Promise<{request:ActionRequest}>{
    return this.deps.runner.run(async tx=>{
      if(!this.deps.effects.readAnomaly||!this.deps.tickets.insert)throw new ApplicationError('DEPENDENCY_UNAVAILABLE','异常审核入口不可用');
      await this.deps.requests.lockRequester?.(input.actorId,tx);
      const facts=await this.deps.effects.readAnomaly(input.groupId,input.orderId,tx);
      const payload={anomalyGroupId:input.groupId},duplicate=await this.deps.requests.findByClientKey(input.actorId,input.clientRequestId,tx);
      if(duplicate){const s=duplicate.state;if(s.orderId!==input.orderId||s.kind!=='refund'||s.reason!==input.reason.trim()||!isDeepStrictEqual(s.payload,payload))throw new ApplicationError('IDEMPOTENCY_CONFLICT','申请键已用于不同内容');return {request:duplicate};}
      const ticket=Ticket.create({userId:facts.userId,type:'shipment_issue',title:'零分配异常退款审核',description:input.reason,relatedOrderId:input.orderId,relatedGroupId:input.groupId,status:'processing',now:this.deps.clock.now()}).assign(input.actorId);
      await this.deps.tickets.insert(ticket,tx);await this.deps.tickets.insertAction(ticket.state.ticketId,{action:'create',actorType:'agent',actorId:input.actorId,detail:{anomalyGroupId:input.groupId},createdAt:this.deps.clock.now()},tx);
      return this.submitLocked({...input,ticketId:ticket.state.ticketId,kind:'refund',payload},ticket,tx);
    });
  }
  async review(input:{requestId:string;decision:'approve'|'reject';reason:string;actorId:string;isSuperAdmin:boolean}):Promise<{request:ActionRequest}>{
    if(!input.isSuperAdmin)throw new ApplicationError('FORBIDDEN','只有超级管理员可以审核');
    if(!uuidPattern.test(input.requestId)||!['approve','reject'].includes(input.decision)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw new ApplicationError('VALIDATION_FAILED','审核参数非法');
    const reason=input.reason.trim();
    return this.deps.runner.run(async tx=>{
      const request=await this.deps.requests.findByIdForUpdate(input.requestId,tx);if(!request)throw new ApplicationError('NOT_FOUND','申请不存在');
      const state=request.state;
      if(state.status!=='pending'){if((state.status==='executed')===(input.decision==='approve')&&state.reviewReason===reason)return {request};throw new ApplicationError('APPROVAL_STATE_CONFLICT','申请已按其他决定审核');}
      let ticket=await this.deps.tickets.findByIdForUpdate(state.ticketId,tx);if(!ticket||ticket.state.relatedOrderId!==state.orderId)throw new ApplicationError('NOT_FOUND','工单关联订单不一致');
      let resultId:string|null=null;
      if(input.decision==='approve'){
        if(ticket.state.status==='closed')throw new ApplicationError('TICKET_STATE_CONFLICT','已关闭工单不能执行待审核申请');
        if(state.kind==='refund'){
          const facts=await this.deps.effects.validateRefund({orderId:state.orderId,userId:ticket.state.userId},tx);
          if(facts.amountFen!==state.amountFen)throw new ApplicationError('REFUND_NOT_ALLOWED','支付事实与申请金额不一致');
          resultId=(await this.deps.effects.createRefund({orderId:state.orderId,userId:ticket.state.userId,adminId:input.actorId,reason:state.reason},tx)).refundId;
          ticket=ticket.recordRefund(resultId,this.deps.clock.now());await this.deps.tickets.save(ticket,tx);
        }else{
          await this.deps.effects.validateReshipment({orderId:state.orderId,userId:ticket.state.userId,payload:state.payload},tx);
          resultId=(await this.deps.effects.createReshipment({orderId:state.orderId,userId:ticket.state.userId,payload:state.payload,adminId:input.actorId,reason:state.reason},tx)).shipmentId;
        }
      }
      const reviewed=request.reviewed(input.decision,input.actorId,reason,resultId,this.deps.clock.now());
      await this.deps.requests.save(reviewed,tx);
      await this.deps.tickets.insertAction(state.ticketId,{action:`${input.decision==='approve'?'approve':'reject'}_${state.kind}` as TicketActionData['action'],actorType:'admin',actorId:input.actorId,detail:{requestId:state.id,reason,resultId,status:reviewed.state.status},createdAt:this.deps.clock.now()},tx);
      await this.deps.audit.execute({adminId:input.actorId,action:`ticket.${input.decision}_${state.kind}`,resourceType:'after_sales_request',resourceId:state.id,requestId:null,detail:{ticketId:state.ticketId,resultId}},tx);
      return {request:reviewed};
    });
  }
}
