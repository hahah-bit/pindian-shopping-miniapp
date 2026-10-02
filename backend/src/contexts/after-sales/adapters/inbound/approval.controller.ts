import{Controller,Get,Post,HttpCode,Inject,Param,Body,Req}from'@nestjs/common';
import{ApprovalService}from'../../application/approval';import{approvalView}from'../../application/approval-view';import{uuidPattern}from'../../domain/action-request';
import{ApplicationError}from'../../../../shared/kernel';
import{RequirePermissions}from'../../../identity-access/adapters/inbound/admin/route-access';import type{RequestWithPrincipal}from'../../../identity-access/adapters/inbound/admin/access.guard';
function field(value:unknown){if(typeof value!=='string')throw new ApplicationError('VALIDATION_FAILED','申请字段应为文本');return value;}
function uuid(value:unknown){const s=field(value);if(!uuidPattern.test(s))throw new ApplicationError('VALIDATION_FAILED','资源ID非法');return s;}
@Controller('admin/v1')
export class ApprovalController {
  constructor(@Inject(ApprovalService)private readonly service:ApprovalService){}
  @Get('after-sales/tickets/:id/fulfillment') @RequirePermissions('agent:manage')
  async fulfillment(@Param('id')id:string,@Req()r:RequestWithPrincipal){return {data:{fulfillment:await this.service.fulfillment(uuid(id),r.adminAuth!.adminId,r.adminAuth!.permissions.includes('agent:supervise'))},requestId:r.requestId};}
  @Get('after-sales/tickets/:id/requests') @RequirePermissions('agent:manage')
  async list(@Param('id')id:string,@Req()r:RequestWithPrincipal){return {data:{items:(await this.service.list(uuid(id),r.adminAuth!.adminId,r.adminAuth!.permissions.includes('agent:supervise'))).map(req=>approvalView(req,true))},requestId:r.requestId};}
  @Post('after-sales/tickets/:id/refund') @HttpCode(202) @RequirePermissions('agent:manage')
  async refund(@Param('id')id:string,@Body()body:Record<string,unknown>,@Req()r:RequestWithPrincipal){return this.submit(id,body,r,'refund');}
  @Post('after-sales/tickets/:id/reshipment') @HttpCode(202) @RequirePermissions('agent:manage')
  async reship(@Param('id')id:string,@Body()body:Record<string,unknown>,@Req()r:RequestWithPrincipal){return this.submit(id,body,r,'reshipment');}
  private async submit(id:string,body:Record<string,unknown>,r:RequestWithPrincipal,kind:'refund'|'reshipment'){
    const result=await this.service.submit({ticketId:uuid(id),orderId:uuid(body?.orderId),kind,clientRequestId:field(body?.clientRequestId),reason:field(body?.reason),payload:kind==='refund'?{}:{fulfillmentId:uuid(body?.fulfillmentId),quantityGrams:body?.quantityGrams,company:field(body?.company),trackingNo:field(body?.trackingNo)},actorId:r.adminAuth!.adminId,isSupervisor:r.adminAuth!.permissions.includes('agent:supervise')});
    return {data:{request:approvalView(result.request,true)},requestId:r.requestId};
  }
  @Post('after-sales/requests/:id/review') @HttpCode(200) @RequirePermissions('admin:manage')
  async review(@Param('id')id:string,@Body()body:Record<string,unknown>,@Req()r:RequestWithPrincipal){const result=await this.service.review({requestId:uuid(id),decision:field(body?.decision) as 'approve'|'reject',reason:field(body?.reason),actorId:r.adminAuth!.adminId,isSuperAdmin:r.adminAuth!.role==='super_admin'});return {data:{request:approvalView(result.request,true)},requestId:r.requestId};}
  @Post('fulfillment/blocks/:groupId/orders/:orderId/refund-request') @HttpCode(202) @RequirePermissions('agent:manage')
  async anomaly(@Param('groupId')groupId:string,@Param('orderId')orderId:string,@Body()body:Record<string,unknown>,@Req()r:RequestWithPrincipal){const result=await this.service.submitAnomaly({groupId:uuid(groupId),orderId:uuid(orderId),actorId:r.adminAuth!.adminId,clientRequestId:field(body?.clientRequestId),reason:field(body?.reason)});return {data:{request:approvalView(result.request,true)},requestId:r.requestId};}
}
