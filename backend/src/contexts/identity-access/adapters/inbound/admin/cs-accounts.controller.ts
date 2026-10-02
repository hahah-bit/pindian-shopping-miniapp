import {Controller,Get,Post,Inject,Body,Param,Req} from '@nestjs/common';
import {ManageCsAccounts} from '../../../application/cs-accounts';
import {RequirePermissions} from './route-access';import type {RequestWithPrincipal} from './access.guard';
@Controller('admin/v1/cs/accounts')
export class CsAccountsController {
  constructor(@Inject(ManageCsAccounts)private readonly accounts:ManageCsAccounts){}
  @Get() @RequirePermissions('admin:manage') async list(@Req()r:RequestWithPrincipal){return {data:{items:await this.accounts.list()},requestId:r.requestId};}
  @Post() @RequirePermissions('admin:manage') async create(@Body()body:{username?:unknown;displayName?:unknown;password?:unknown;role?:unknown},@Req()r:RequestWithPrincipal){return {data:await this.accounts.create({...body,username:body?.username,displayName:body?.displayName,password:body?.password,role:body?.role,actorId:r.adminAuth!.adminId}),requestId:r.requestId};}
  @Post(':id/status') @RequirePermissions('admin:manage') async status(@Param('id')id:string,@Body()body:{status?:unknown},@Req()r:RequestWithPrincipal){return {data:await this.accounts.status({id,status:body?.status,actorId:r.adminAuth!.adminId}),requestId:r.requestId};}
}
