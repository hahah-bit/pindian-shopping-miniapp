import {Controller,Post,Get,Inject,Param,Req,UploadedFile,UseInterceptors,StreamableFile,Header} from '@nestjs/common';
import {FileInterceptor} from '@nestjs/platform-express';
import {AuthRealm,RequirePermissions} from '../../../identity-access/adapters/inbound/admin/route-access';
import type {RequestWithPrincipal} from '../../../identity-access/adapters/inbound/admin/access.guard';
import {ChatMediaUseCase} from '../../application/chat-media';
@Controller()
export class ChatMediaController {
  constructor(@Inject(ChatMediaUseCase)private readonly media:ChatMediaUseCase){}
  @Post('mini/v1/conversations/:id/images') @AuthRealm('user')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024}}))
  async uploadUser(@Param('id')id:string,@UploadedFile()file:{buffer?:Buffer}|undefined,@Req()r:RequestWithPrincipal){return {data:await this.media.upload({conversationId:id,userId:r.userAuth?.userId,buffer:file?.buffer}),requestId:r.requestId};}
  @Post('admin/v1/cs/conversations/:id/images') @RequirePermissions('agent:manage')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024}}))
  async uploadAgent(@Param('id')id:string,@UploadedFile()file:{buffer?:Buffer}|undefined,@Req()r:RequestWithPrincipal){return {data:await this.media.upload({conversationId:id,agentId:r.adminAuth?.adminId,buffer:file?.buffer}),requestId:r.requestId};}
  @Get('mini/v1/chat-images/:id') @AuthRealm('user')
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  async readUser(@Param('id')id:string,@Req()r:RequestWithPrincipal){return this.binary(await this.media.read({id,userId:r.userAuth?.userId}));}
  @Get('admin/v1/cs/images/:id') @RequirePermissions('agent:manage')
  @Header('Cache-Control','private, no-store') @Header('X-Content-Type-Options','nosniff')
  async readAgent(@Param('id')id:string,@Req()r:RequestWithPrincipal){return this.binary(await this.media.read({id,agentId:r.adminAuth?.adminId}));}
  private binary(image:{format:string;buffer:Buffer}) {return new StreamableFile(image.buffer,{type:`image/${image.format}`,disposition:'inline',length:image.buffer.length});}
}
