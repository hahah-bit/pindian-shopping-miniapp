import{ApplicationError}from'../shared/kernel';
import type{ApprovalEffects}from'../contexts/after-sales/application/approval';
import type{AfterSalesFulfillmentService}from'../contexts/fulfillment/application/after-sales-fulfillment';
import type{CreateFullRefundUseCase}from'../contexts/payments/application/refund-flow';
import type{PaymentRepository}from'../contexts/payments/application/ports';
import type{RefundRepositoryPort}from'../contexts/payments/application/refund-ports';
/** 同进程跨领域流程装配，资金/包裹仍由所属领域公开用例创建。 */
export class ReviewedAfterSalesEffects implements ApprovalEffects {
  constructor(private readonly deps:{orders:{findById(id:string,tx?:unknown):Promise<{state:{orderId:string;userId:string;groupId:string;status:string}}|null>};groups:{findByIdForUpdate(id:string,tx:unknown):Promise<{state:{status:string}}|null>};payments:PaymentRepository;refunds:RefundRepositoryPort;creator:CreateFullRefundUseCase;fulfillment:AfterSalesFulfillmentService}){}
  fulfillmentSummary(orderId:string,userId:string){return this.deps.fulfillment.summary(orderId,userId);}
  async validateRefund(input:{orderId:string;userId:string},tx:unknown){
    const order=await this.deps.orders.findById(input.orderId,tx);if(!order||order.state.userId!==input.userId)throw new ApplicationError('NOT_FOUND','订单不存在');
    const group=await this.deps.groups.findByIdForUpdate(order.state.groupId,tx);
    if(order.state.status!=='paid'||!group||!['success','failed'].includes(group.state.status))throw new ApplicationError('REFUND_NOT_ALLOWED','售后退款仅处理成功或失败组的已支付订单；进行中组请按取消流程处理');
    const payment=await this.deps.payments.findByOrderId(input.orderId,tx);
    if(!payment||payment.state.userId!==input.userId||payment.state.status!=='succeeded'||payment.state.appliedResult!=='applied')throw new ApplicationError('REFUND_NOT_ALLOWED','无本人已生效支付事实');
    if((await this.deps.refunds.findByPaymentId(payment.state.paymentId,tx)).length)throw new ApplicationError('REFUND_NOT_ALLOWED','该支付已存在全额退款，请使用原退款重试或查询');
    return {amountFen:payment.state.amountFen};
  }
  async createRefund(input:{orderId:string;userId:string;adminId:string;reason:string},tx:unknown){
    await this.validateRefund(input,tx);const payment=await this.deps.payments.findByOrderId(input.orderId,tx);
    const result=await this.deps.creator.execute({paymentId:payment!.state.paymentId,orderId:input.orderId,userId:input.userId,reason:'after_sales'},tx);
    await this.deps.fulfillment.holdRefund(input.orderId,result.refundId,tx);return result;
  }
  async validateReshipment(input:{orderId:string;userId:string;payload:Record<string,unknown>},tx:unknown){const order=await this.deps.orders.findById(input.orderId,tx);if(!order||order.state.userId!==input.userId)throw new ApplicationError('NOT_FOUND','订单不存在');await this.deps.groups.findByIdForUpdate(order.state.groupId,tx);await this.deps.fulfillment.validateReshipment(input,tx);}
  createReshipment(input:{orderId:string;userId:string;payload:Record<string,unknown>;adminId:string;reason:string},tx:unknown){return this.deps.fulfillment.createReshipment(input,tx);}
  async readAnomaly(groupId:string,orderId:string,tx:unknown){const group=await this.deps.groups.findByIdForUpdate(groupId,tx);const order=await this.deps.orders.findById(orderId,tx);if(!group||group.state.status!=='success'||!order||order.state.groupId!==groupId||!(await this.deps.fulfillment.isZeroAllocationGroup(groupId,tx)))throw new ApplicationError('NOT_FOUND','零分配异常组或订单不存在');return {userId:order.state.userId};}
}
