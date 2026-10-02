import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import type {Response} from 'express';
import type { ApiResponse } from '@pindian/contracts';
import { ApplicationError } from '../../../../shared/kernel';
import type { RequestWithPrincipal } from '../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm, RequirePermissions } from '../../../identity-access/adapters/inbound/admin/route-access';
import { CreateConversationUseCase, AppendMessageUseCase, ListMessagesUseCase } from '../../application/conversation-usecases';
import { AcceptConversationUseCase, TransferConversationUseCase, EndConversationUseCase, AgentHeartbeatUseCase } from '../../application/agent-usecases';
import { CreateTicketUseCase, ProcessTicketUseCase } from '../../../after-sales/application/ticket-usecases';
import { ConvertConversationToTicketUseCase } from '../../../after-sales/application/ticket-coordination';
import { CardProjectionUseCase } from '../../application/card-projection';
import type{ApprovalRepository}from'../../../after-sales/application/approval';
import{approvalView}from'../../../after-sales/application/approval-view';

export interface MiniConversationDeps {
  requests:Pick<ApprovalRepository,'list'>;
  create: CreateConversationUseCase;
  append: AppendMessageUseCase;
  list: ListMessagesUseCase;
  conversations: { findOpenByUserId(userId: string): Promise<{ state: { conversationId: string; status: string; assignedAgentId: string | null } } | null>; findById(id: string): Promise<{ state: { conversationId: string; userId: string; status: string; assignedAgentId: string | null } } | null>; listByUser(userId: string, page: number, pageSize: number): Promise<{ items: Array<{state:{conversationId:string;status:string;assignedAgentId:string|null}}>;total:number }>; acknowledge(id: string, actorId: string, seq: number): Promise<void> };
  end: EndConversationUseCase;
  createTicket: CreateTicketUseCase;
  tickets: { listByUser(userId: string, page: number, pageSize: number): Promise<{ items: Array<{ state: Record<string, unknown> }>; total: number }>; findById(id: string): Promise<{ state: Record<string, unknown> } | null>; listActions(id: string): Promise<Array<{ action: string; actorType: string; detail: Record<string, unknown>; createdAt: Date }>> };
  processTicket: ProcessTicketUseCase;
}

function userOf(request: RequestWithPrincipal): string {
  const userId = request.userAuth?.userId;
  if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
  return userId;
}

function view(c: { state: { conversationId: string; status: string; assignedAgentId: string | null } }): Record<string, unknown> {
  return { id: c.state.conversationId, status: c.state.status, hasAgent: Boolean(c.state.assignedAgentId) };
}

function viewLoose(c: { state: Record<string, unknown> }): Record<string, unknown> {
  const s = c.state as { conversationId: string; status: string; assignedAgentId: string | null };
  return view({ state: s });
}
function messageView(m:{seq:number;sender:string;kind:string;content:Record<string,unknown>;internal:boolean;createdAt:Date},internal=false){return {seq:m.seq,sender:m.sender,kind:m.kind,content:m.content,createdAt:m.createdAt.toISOString(),...(internal?{internal:m.internal}:{})};}
function ticketView(state:Record<string,unknown>,admin=false){
  const fields=['ticketId','conversationId','type','status','title','description','relatedOrderId','relatedGroupId','relatedRefundId','createdAt','updatedAt'];
  if(admin)fields.push('assignedAgentId');
  return Object.fromEntries(fields.map(key=>[key,state[key]]));
}

/** 小程序客服会话与本人工单（F030 对应端）：仅本人数据，他人一律 404。 */
@Controller('mini/v1')
export class MiniCsController {
  constructor(@Inject('MINI_CS_DEPS') private readonly deps: MiniConversationDeps) {}

  @AuthRealm('user')
  @Post('conversations')
  async create(@Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.create.execute({ userId: userOf(request) });
    return { data: { conversation: view(result.conversation) }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Get('conversations/current')
  async current(@Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const found = await this.deps.conversations.findOpenByUserId(userOf(request));
    return { data: { conversation: found ? view(found) : null }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Get('conversations')
  async history(@Query() query: Record<string,string|undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const {page,pageSize} = paging(query);
    const result = await this.deps.conversations.listByUser(userOf(request),page,pageSize);
    return {data:{items:result.items.map(view),total:result.total,page,pageSize},requestId:request.requestId};
  }

  @AuthRealm('user')
  @Get('conversations/:id')
  async conversation(@Param('id') id:string,@Req() request:RequestWithPrincipal):Promise<ApiResponse<unknown>> {
    const c=await this.deps.conversations.findById(id);
    if (!c || c.state.userId!==userOf(request)) throw new ApplicationError('NOT_FOUND','会话不存在');
    return {data:{conversation:view(c)},requestId:request.requestId};
  }

  @AuthRealm('user')
  @Post('conversations/:id/read')
  @HttpCode(200)
  async read(@Param('id') id:string,@Body() body:{seq?:unknown},@Req() request:RequestWithPrincipal):Promise<ApiResponse<unknown>> {
    const seq=Number(body?.seq);
    if (!Number.isSafeInteger(seq)||seq<0) throw new ApplicationError('VALIDATION_FAILED','读确认序号非法');
    const result=await this.deps.list.execute({conversationId:id,userId:userOf(request),afterSeq:Math.max(0,seq-1),limit:1});
    if (seq>0 && result.messages[0]?.seq!==seq) throw new ApplicationError('VALIDATION_FAILED','只能确认可见消息');
    await this.deps.conversations.acknowledge(id,userOf(request),seq);
    return {data:{ok:true},requestId:request.requestId};
  }

  @AuthRealm('user')
  @Get('conversations/:id/messages')
  async messages(@Param('id') id: string, @Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.list.execute({ conversationId: id, userId: userOf(request), afterSeq: query.afterSeq, limit: query.limit });
    return { data: {...result,messages:result.messages.map(m=>messageView(m))}, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('conversations/:id/messages')
  async send(@Param('id') id: string, @Body() body: { clientMessageId?: unknown; kind?: unknown; content?: unknown }, @Req() request: RequestWithPrincipal,@Res({passthrough:true})response:Response): Promise<ApiResponse<unknown>> {
    const result = await this.deps.append.execute({
      conversationId: id, userId: userOf(request), clientMessageId: body?.clientMessageId, kind: body?.kind, content: body?.content, sender: 'user'
    });
    response.status(result.duplicated?200:201);
    return { data: { message:messageView(result.message), duplicated: result.duplicated }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('conversations/:id/end')
  @HttpCode(200)
  async end(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.end.execute({ conversationId: id, userId: userOf(request) });
    return { data: { conversation: view(result.conversation) }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('tickets')
  async createTicket(@Body() body: { type?: unknown; title?: unknown; description?: unknown; orderId?: unknown;clientTicketId?:unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.createTicket.execute({ userId: userOf(request), type: body?.type, title: body?.title, description: body?.description, orderId: body?.orderId,clientTicketId:body?.clientTicketId });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Get('tickets')
  async listTickets(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const {page,pageSize}=paging(query);
    const result = await this.deps.tickets.listByUser(userOf(request), page, pageSize);
    return { data: { items: result.items.map((t) => ({ id: (t.state as { ticketId: string }).ticketId, type: (t.state as { type: string }).type, status: (t.state as { status: string }).status, title: (t.state as { title: string }).title, createdAt: (t.state as { createdAt: Date }).createdAt })), page, pageSize, total: result.total }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Get('tickets/:id')
  async ticket(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const ticket = await this.deps.tickets.findById(id);
    if (!ticket || (ticket.state as { userId: string }).userId !== userOf(request)) throw new ApplicationError('NOT_FOUND', '工单不存在');
    const actions = await this.deps.tickets.listActions(id);
    return { data: { ticket: ticketView(ticket.state), actions: actions.filter(a => !a.detail.internal).map(a => ({ action: a.action, actorType: a.actorType, detail: a.detail, createdAt: a.createdAt })),requests:(await this.deps.requests.list(id)).map(req=>approvalView(req)) }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('tickets/:id/feedback')
  @HttpCode(200)
  async feedback(@Param('id') id: string, @Body() body: { satisfied?: boolean; text?: unknown;clientActionId?:unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.processTicket.execute({
      ticketId: id, action: 'user_feedback', userId: userOf(request),clientActionId:body?.clientActionId,
      detail: { satisfied: body?.satisfied, text: body?.text ?? undefined }
    });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }
}

export interface AdminCsDeps {
  cards: CardProjectionUseCase;
  heartbeat: AgentHeartbeatUseCase;
  accept: AcceptConversationUseCase;
  transfer: TransferConversationUseCase;
  end: EndConversationUseCase;
  append: AppendMessageUseCase;
  list: ListMessagesUseCase;
  process: ProcessTicketUseCase;
  conversations: { countByAgent(agentId:string,statuses:string[]):Promise<number>;listOnline():Promise<Array<{id:string;displayName:string;activeCount:number}>>; listQueue(limit: number): Promise<Array<{ state: Record<string, unknown> }>>; listByAgent(agentId: string, statuses: string[],page?:number,pageSize?:number): Promise<Array<{ state: Record<string, unknown> }>>; findById(id: string): Promise<{ state: { conversationId: string; userId: string; status: string; assignedAgentId: string | null } } | null> };
  convertTicket: ConvertConversationToTicketUseCase;
  tickets: { listAdmin(query: { status?: string | null; page: number; pageSize: number; agentId?:string }): Promise<{ items: Array<{ state: Record<string, unknown> }>; total: number }>; findById(id: string): Promise<{ state: Record<string, unknown> } | null>; listActions(id: string): Promise<unknown> };
}

function adminOf(request: RequestWithPrincipal): string {
  const adminId = request.adminAuth?.adminId;
  if (!adminId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
  return adminId;
}

/** 客服工作台与工单管理（agent:manage）。 */
@Controller('admin/v1')
export class AdminCsController {
  constructor(@Inject('ADMIN_CS_DEPS') private readonly deps: AdminCsDeps) {}

  @Get('cs/queue')
  @RequirePermissions('agent:manage')
  async queue(@Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const items = await this.deps.conversations.listQueue(50);
    return { data: { items: items.map(viewLoose) }, requestId: request.requestId };
  }

  @Get('cs/conversations')
  @RequirePermissions('agent:manage')
  async list(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const status = query.status ?? 'active';
    if(!['queued','active','ended','converted'].includes(status))throw new ApplicationError('VALIDATION_FAILED','会话状态非法');
    const {page,pageSize}=paging(query);
    const items = await this.deps.conversations.listByAgent(adminOf(request), [status],page,pageSize);
    const total=await this.deps.conversations.countByAgent(adminOf(request),[status]);
    return { data: { items: items.map(viewLoose),page,pageSize,total }, requestId: request.requestId };
  }

  @Post('cs/heartbeat')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async heartbeat(@Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    await this.deps.heartbeat.execute(adminOf(request));
    return { data: { ok: true, at: new Date().toISOString() }, requestId: request.requestId };
  }

  @Get('cs/agents')
  @RequirePermissions('agent:manage')
  async agents(@Req() request:RequestWithPrincipal):Promise<ApiResponse<unknown>> {return {data:{items:await this.deps.conversations.listOnline()},requestId:request.requestId};}

  private async ownConversation(id:string,r:RequestWithPrincipal) {
    const c=await this.deps.conversations.findById(id);
    if(!c||c.state.assignedAgentId!==adminOf(r))throw new ApplicationError('NOT_FOUND','会话不存在');
    return c;
  }
  @Get('cs/conversations/:id') @RequirePermissions('agent:manage')
  async conversation(@Param('id')id:string,@Req()r:RequestWithPrincipal){return {data:{conversation:view(await this.ownConversation(id,r))},requestId:r.requestId};}
  @Get('cs/conversations/:id/card-options/:kind') @RequirePermissions('agent:manage')
  async cardOptions(@Param('id')id:string,@Param('kind')kind:string,@Req()r:RequestWithPrincipal){const c=await this.ownConversation(id,r);return {data:{items:await this.deps.cards.options(c.state.userId,kind)},requestId:r.requestId};}
  @Get('cs/conversations/:id/cards/:kind/:ref') @RequirePermissions('agent:manage')
  async card(@Param('id')id:string,@Param('kind')kind:string,@Param('ref')ref:string,@Req()r:RequestWithPrincipal){const c=await this.ownConversation(id,r);return {data:await this.deps.cards.execute(c.state.userId,kind,ref),requestId:r.requestId};}

  @Post('cs/conversations/:id/notes')
  @RequirePermissions('agent:manage')
  async note(@Param('id') id:string,@Body() body:{text?:unknown;clientMessageId?:unknown},@Req() request:RequestWithPrincipal):Promise<ApiResponse<unknown>> {
    const result=await this.deps.append.execute({conversationId:id,agentId:adminOf(request),clientMessageId:body?.clientMessageId,kind:'note',content:{text:body?.text},sender:'agent',internal:true});
    return {data:{message:messageView(result.message,true),duplicated:result.duplicated},requestId:request.requestId};
  }

  @Post('cs/conversations/:id/accept')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async accept(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.accept.execute({ conversationId: id, agentId: adminOf(request) });
    return { data: { conversation: view(result.conversation) }, requestId: request.requestId };
  }

  @Post('cs/conversations/:id/messages')
  @RequirePermissions('agent:manage')
  async send(@Param('id') id: string, @Body() body: { clientMessageId?: unknown; kind?: unknown; content?: unknown; internal?: boolean }, @Req() request: RequestWithPrincipal,@Res({passthrough:true})response:Response): Promise<ApiResponse<unknown>> {
    const result = await this.deps.append.execute({
      conversationId: id, agentId: adminOf(request), clientMessageId: body?.clientMessageId, kind: body?.kind, content: body?.content, sender: 'agent', internal: Boolean(body?.internal)
    });
    response.status(result.duplicated?200:201);
    return { data: { message:messageView(result.message,true), duplicated: result.duplicated }, requestId: request.requestId };
  }

  @Get('cs/conversations/:id/messages')
  @RequirePermissions('agent:manage')
  async messages(@Param('id') id: string, @Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.list.execute({ conversationId: id, agentId: adminOf(request), afterSeq: query.afterSeq, limit: query.limit, includeInternal: true });
    return { data: {...result,messages:result.messages.map(m=>messageView(m,true))}, requestId: request.requestId };
  }

  @Post('cs/conversations/:id/transfer')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async transfer(@Param('id') id: string, @Body() body: { targetAgentId?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.transfer.execute({ conversationId: id, agentId: adminOf(request), targetAgentId: body?.targetAgentId });
    return { data: { conversation: view(result.conversation) }, requestId: request.requestId };
  }

  @Post('cs/conversations/:id/end')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async end(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.end.execute({ conversationId: id, agentId: adminOf(request) });
    return { data: { conversation: view(result.conversation) }, requestId: request.requestId };
  }

  @Post('cs/conversations/:id/convert-ticket')
  @RequirePermissions('agent:manage')
  async convert(@Param('id') id: string, @Body() body: { type?: unknown; title?: unknown; description?: unknown;orderId?:unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.convertTicket.execute({ conversationId: id, agentId: adminOf(request), type: body?.type, title: body?.title, description: body?.description,orderId:body?.orderId });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @Get('after-sales/tickets')
  @RequirePermissions('agent:manage')
  async tickets(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const {page,pageSize}=paging(query);
    if(query.status&&!['open','processing','waiting_feedback','resolved','closed'].includes(query.status))throw new ApplicationError('VALIDATION_FAILED','工单状态非法');
    const result = await this.deps.tickets.listAdmin({ status: query.status ?? null, page, pageSize, agentId: supervisor(request) ? undefined : adminOf(request) });
    return { data: { items: result.items.map((t) => ({ id: (t.state as { ticketId: string }).ticketId, type: (t.state as { type: string }).type, status: (t.state as { status: string }).status, title: (t.state as { title: string }).title, createdAt: (t.state as { createdAt: Date }).createdAt })), page, pageSize, total: result.total }, requestId: request.requestId };
  }

  @Get('after-sales/tickets/:id')
  @RequirePermissions('agent:manage')
  async ticket(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const ticket = await this.deps.tickets.findById(id);
    if (!ticket) throw new ApplicationError('NOT_FOUND', '工单不存在');
    if (!supervisor(request) && ticket.state.assignedAgentId !== adminOf(request)) throw new ApplicationError('NOT_FOUND','工单未分配给您');
    const actions = await this.deps.tickets.listActions(id);
    return { data: { ticket: ticketView(ticket.state,true), actions }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/accept')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async acceptTicket(@Param('id') id: string, @Body()body:{clientActionId?:unknown}, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.process.execute({ ticketId: id, action: 'accept', adminId: adminOf(request),clientActionId:body?.clientActionId });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/reply')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async replyTicket(@Param('id') id: string, @Body() body: { text?: unknown;clientActionId?:unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.process.execute({ ticketId: id, action: 'reply', adminId: adminOf(request), isSupervisor:supervisor(request),clientActionId:body?.clientActionId, detail: { text: body?.text ?? '' } });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/resolve')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async resolveTicket(@Param('id') id: string, @Body() body: { reply?: unknown;clientActionId?:unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.process.execute({ ticketId: id, action: 'resolve', adminId: adminOf(request), isSupervisor:supervisor(request),clientActionId:body?.clientActionId, detail: { reply: body?.reply ?? '' } });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/request-feedback') @HttpCode(200) @RequirePermissions('agent:manage')
  async requestFeedback(@Param('id')id:string,@Body()body:{text?:unknown;clientActionId?:unknown},@Req()r:RequestWithPrincipal){const result=await this.deps.process.execute({ticketId:id,action:'request_feedback',adminId:adminOf(r),isSupervisor:supervisor(r),clientActionId:body?.clientActionId,detail:{text:body?.text}});return {data:{ticket:{id:result.ticket.state.ticketId,status:result.ticket.state.status}},requestId:r.requestId};}

  @Post('after-sales/tickets/:id/close')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async closeTicket(@Param('id') id: string, @Body() body: { reason?: unknown;clientActionId?:unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.process.execute({ ticketId: id, action: 'close', adminId: adminOf(request), isSupervisor:supervisor(request),clientActionId:body?.clientActionId, detail: { reason: body?.reason ?? '' } });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

}

function paging(query: Record<string,string|undefined>): {page:number;pageSize:number} {
  const page=Number(query.page??1),pageSize=Number(query.pageSize??10);
  if (!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100) throw new ApplicationError('VALIDATION_FAILED','分页参数非法');
  return {page,pageSize};
}
function supervisor(request: RequestWithPrincipal): boolean { return Boolean(request.adminAuth?.permissions.includes('agent:supervise')); }
