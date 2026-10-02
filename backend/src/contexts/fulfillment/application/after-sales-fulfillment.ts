import {ApplicationError}from'../../../shared/kernel';import type{FulfillmentOrderRepository}from'./ports';import{ShipFulfillmentUseCase}from'./admin-fulfillment';
/** 售后公开能力：归属与退款停止事实独立成立，包裹由既有聚合产生。 */
export class AfterSalesFulfillmentService {
  constructor(private readonly repository:FulfillmentOrderRepository&{holdRefund(orderId:string,refundId:string,tx:unknown):Promise<void>;isZeroAllocationGroup(groupId:string,tx:unknown):Promise<boolean>},private readonly ship:ShipFulfillmentUseCase){}
  async summary(orderId:string,userId:string){
    const f=await this.repository.findByOrderId(orderId);
    if(!f||f.state.userId!==userId)return null;
    return {id:f.state.fulfillmentOrderId,unit:f.state.unit,allocatedQuantityGrams:f.state.allocatedQuantityGrams,shippedQuantityGrams:f.state.shippedQuantityGrams,status:f.state.status,refundHeld:Boolean(await this.repository.isRefundHeld?.(orderId))};
  }
  async validateReshipment(input:{orderId:string;userId:string;payload:Record<string,unknown>},tx:unknown){
    const f=await this.repository.findByOrderId(input.orderId,tx);
    if(!f||f.state.userId!==input.userId||f.state.fulfillmentOrderId!==input.payload.fulfillmentId)throw new ApplicationError('NOT_FOUND','履约单与工单订单不一致');
    if(await this.repository.isRefundHeld?.(input.orderId,tx))throw new ApplicationError('ORDER_REFUND_HELD','已批准全额退款订单不能补发');
  }
  async createReshipment(input:{orderId:string;userId:string;payload:Record<string,unknown>;reason:string;adminId:string},tx:unknown){
    await this.validateReshipment(input,tx);const p=input.payload;
    const result=await this.ship.execute({fulfillmentId:p.fulfillmentId,quantityGrams:p.quantityGrams,company:p.company,trackingNo:p.trackingNo,isReissue:true,reason:input.reason,adminId:input.adminId,requestId:null},tx);
    return {shipmentId:result.shipmentId};
  }
  holdRefund(orderId:string,refundId:string,tx:unknown){return this.repository.holdRefund(orderId,refundId,tx);}
  isZeroAllocationGroup(groupId:string,tx:unknown){return this.repository.isZeroAllocationGroup(groupId,tx);}
}
