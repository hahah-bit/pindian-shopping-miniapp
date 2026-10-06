import {Body,Controller,Get,Post,Query,Req,HttpCode,Inject} from '@nestjs/common';
import {AuthRealm} from '../../../../identity-access/adapters/inbound/admin/route-access';
import type {RequestWithPrincipal} from '../../../../identity-access/adapters/inbound/admin/access.guard';
import {AiSupportService} from '../../../application/ai-support/service';
@Controller('mini/v1/ai-support')
@AuthRealm('user')
export class AiSupportController {
  constructor(@Inject(AiSupportService) private readonly service:AiSupportService){}
  @Get('messages')
  async list(@Req() req:RequestWithPrincipal,@Query() query:Record<string,string|undefined>){return{data:await this.service.list(req.userAuth?.userId??'',query),requestId:req.requestId};}
  @Post('messages')
  @HttpCode(200)
  async send(@Req() req:RequestWithPrincipal,@Body() body:Record<string,unknown>){return{data:await this.service.send(req.userAuth?.userId??'',body),requestId:req.requestId};}
}
