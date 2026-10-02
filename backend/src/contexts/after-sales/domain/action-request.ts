import {ApplicationError}from'../../../shared/kernel';
export interface ActionRequestState {
  id:string;ticketId:string;orderId:string;requesterId:string;clientRequestId:string;
  kind:'refund'|'reshipment';status:'pending'|'executed'|'rejected';reason:string;payload:Record<string,unknown>;amountFen:number|null;
  reviewerId:string|null;reviewReason:string|null;resultId:string|null;createdAt:Date;reviewedAt:Date|null;
}
export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ActionRequest {
  private constructor(readonly state:ActionRequestState){}
  static rehydrate(s:ActionRequestState):ActionRequest{return new ActionRequest({...s,payload:{...s.payload}});}
  static create(input:{ticketId:string;orderId:string;requesterId:string;clientRequestId:string;kind:'refund'|'reshipment';reason:string;payload:Record<string,unknown>;amountFen:number|null;now:Date}):ActionRequest {
    if(![input.ticketId,input.orderId,input.requesterId].every(id=>typeof id==='string'&&uuidPattern.test(id)))throw new ApplicationError('VALIDATION_FAILED','申请引用非法');
    if(typeof input.clientRequestId!=='string'||!input.clientRequestId.trim()||input.clientRequestId.length>64)throw new ApplicationError('VALIDATION_FAILED','申请客户端键非法');
    if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw new ApplicationError('VALIDATION_FAILED','申请原因1–1000字');
    if(!['refund','reshipment'].includes(input.kind))throw new ApplicationError('VALIDATION_FAILED','申请类型非法');
    if(input.kind==='refund'&&(!Number.isSafeInteger(input.amountFen)||input.amountFen!<=0))throw new ApplicationError('REFUND_NOT_ALLOWED','没有可全额退款的支付事实');
    if(input.kind==='reshipment'){
      if(input.reason.length>200)throw new ApplicationError('VALIDATION_FAILED','补发原因最多200字');
      const p=input.payload;
      if(typeof p.fulfillmentId!=='string'||!uuidPattern.test(p.fulfillmentId)||!Number.isSafeInteger(p.quantityGrams)||(p.quantityGrams as number)<=0||(p.quantityGrams as number)>2147483647||typeof p.company!=='string'||!p.company.trim()||p.company.length>30||typeof p.trackingNo!=='string'||!p.trackingNo.trim()||p.trackingNo.length>64)throw new ApplicationError('VALIDATION_FAILED','补发履约单、数量、物流信息非法');
    }
    return new ActionRequest({...input,reason:input.reason.trim(),payload:{...input.payload},id:crypto.randomUUID(),status:'pending',reviewerId:null,reviewReason:null,resultId:null,createdAt:input.now,reviewedAt:null});
  }
  reviewed(decision:'approve'|'reject',actorId:string,reason:string,resultId:string|null,now:Date):ActionRequest{
    if(this.state.status!=='pending')throw new ApplicationError('APPROVAL_STATE_CONFLICT','申请已经审核');
    return new ActionRequest({...this.state,status:decision==='approve'?'executed':'rejected',reviewerId:actorId,reviewReason:reason,resultId,reviewedAt:now});
  }
}
