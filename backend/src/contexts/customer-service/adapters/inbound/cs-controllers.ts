import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import { ApplicationError } from '../../../../shared/kernel';
import type { RequestWithPrincipal } from '../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm, RequirePermissions } from '../../../identity-access/adapters/inbound/admin/route-access';
import { CreateConversationUseCase, AppendMessageUseCase, ListMessagesUseCase } from '../../application/conversation-usecases';
import { AcceptConversationUseCase, TransferConversationUseCase, EndConversationUseCase } from '../../application/agent-usecases';
import { CreateTicketUseCase, ProcessTicketUseCase } from '../../../after-sales/application/ticket-usecases';
import { RequestTicketRefundUseCase, ConvertConversationToTicketUseCase } from '../../../after-sales/application/ticket-coordination';

export interface MiniConversationDeps {
  create: CreateConversationUseCase;
  append: AppendMessageUseCase;
  list: ListMessagesUseCase;
  conversations: { findOpenByUserId(userId: string): Promise<{ state: { conversationId: string; status: string; assignedAgentId: string | null } } | null>; findById(id: string): Promise<{ state: { conversationId: string; userId: string; status: string; assignedAgentId: string | null } } | null> };
  end: EndConversationUseCase;
  createTicket: CreateTicketUseCase;
  tickets: { listByUser(userId: string, page: number, pageSize: number): Promise<{ items: Array<{ state: Record<string, unknown> }>; total: number }>; findById(id: string): Promise<{ state: Record<string, unknown> } | null> };
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
  @Get('conversations/:id/messages')
  async messages(@Param('id') id: string, @Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.list.execute({ conversationId: id, userId: userOf(request), afterSeq: query.afterSeq, limit: query.limit });
    return { data: result, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('conversations/:id/messages')
  async send(@Param('id') id: string, @Body() body: { clientMessageId?: unknown; kind?: unknown; content?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.append.execute({
      conversationId: id, userId: userOf(request), clientMessageId: body?.clientMessageId, kind: body?.kind, content: body?.content, sender: 'user'
    });
    return { data: { message: { seq: result.message.seq, sender: result.message.sender, kind: result.message.kind, content: result.message.content, createdAt: result.message.createdAt }, duplicated: result.duplicated }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('conversations/:id/end')
  async end(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.end.execute({ conversationId: id, userId: userOf(request) });
    return { data: { conversation: view(result.conversation) }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('tickets')
  async createTicket(@Body() body: { type?: unknown; title?: unknown; description?: unknown; orderId?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.createTicket.execute({ userId: userOf(request), type: body?.type, title: body?.title, description: body?.description, orderId: body?.orderId });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Get('tickets')
  async listTickets(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(50, Number(query.pageSize ?? 10) || 10);
    const result = await this.deps.tickets.listByUser(userOf(request), page, pageSize);
    return { data: { items: result.items.map((t) => ({ id: (t.state as { ticketId: string }).ticketId, type: (t.state as { type: string }).type, status: (t.state as { status: string }).status, title: (t.state as { title: string }).title, createdAt: (t.state as { createdAt: Date }).createdAt })), page, pageSize, total: result.total }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Get('tickets/:id')
  async ticket(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const ticket = await this.deps.tickets.findById(id);
    if (!ticket || (ticket.state as { userId: string }).userId !== userOf(request)) throw new ApplicationError('NOT_FOUND', '工单不存在');
    return { data: { ticket: ticket.state }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post('tickets/:id/feedback')
  @HttpCode(200)
  async feedback(@Param('id') id: string, @Body() body: { satisfied?: boolean; text?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.processTicket.execute({
      ticketId: id, action: 'user_feedback', userId: userOf(request),
      detail: { satisfied: Boolean(body?.satisfied), text: body?.text ?? undefined }
    });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }
}

export interface AdminCsDeps {
  accept: AcceptConversationUseCase;
  transfer: TransferConversationUseCase;
  end: EndConversationUseCase;
  append: AppendMessageUseCase;
  list: ListMessagesUseCase;
  process: ProcessTicketUseCase;
  conversations: { listQueue(limit: number): Promise<Array<{ state: Record<string, unknown> }>>; listByAgent(agentId: string, statuses: string[]): Promise<Array<{ state: Record<string, unknown> }>>; findById(id: string): Promise<{ state: { conversationId: string; userId: string; status: string; assignedAgentId: string | null } } | null> };
  convertTicket: ConvertConversationToTicketUseCase;
  tickets: { listAdmin(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: Array<{ state: Record<string, unknown> }>; total: number }>; findById(id: string): Promise<{ state: Record<string, unknown> } | null>; listActions(id: string): Promise<unknown> };
  refund: RequestTicketRefundUseCase;
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
    const items = await this.deps.conversations.listByAgent(adminOf(request), [status]);
    return { data: { items: items.map(viewLoose) }, requestId: request.requestId };
  }

  @Post('cs/heartbeat')
  @HttpCode(200)
  @RequirePermissions('agent:manage')
  async heartbeat(@Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    return { data: { ok: true, at: new Date().toISOString() }, requestId: request.requestId };
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
  async send(@Param('id') id: string, @Body() body: { clientMessageId?: unknown; kind?: unknown; content?: unknown; internal?: boolean }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.append.execute({
      conversationId: id, agentId: adminOf(request), clientMessageId: body?.clientMessageId, kind: body?.kind, content: body?.content, sender: 'agent', internal: Boolean(body?.internal)
    });
    return { data: { message: { seq: result.message.seq, sender: result.message.sender, kind: result.message.kind, content: result.message.content, internal: result.message.internal, createdAt: result.message.createdAt }, duplicated: result.duplicated }, requestId: request.requestId };
  }

  @Get('cs/conversations/:id/messages')
  @RequirePermissions('agent:manage')
  async messages(@Param('id') id: string, @Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.list.execute({ conversationId: id, agentId: adminOf(request), afterSeq: query.afterSeq, limit: query.limit, includeInternal: true });
    return { data: result, requestId: request.requestId };
  }

  @Post('cs/conversations/:id/transfer')
  @RequirePermissions('agent:manage')
  async transfer(@Param('id') id: string, @Body() body: { targetAgentId?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.transfer.execute({ conversationId: id, agentId: adminOf(request), targetAgentId: body?.targetAgentId });
    return { data: { conversation: view(result.conversation) }, requestId: request.requestId };
  }

  @Post('cs/conversations/:id/end')
  @RequirePermissions('agent:manage')
  async end(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.end.execute({ conversationId: id, agentId: adminOf(request) });
    return { data: { conversation: view(result.conversation) }, requestId: request.requestId };
  }

  @Post('cs/conversations/:id/convert-ticket')
  @RequirePermissions('agent:manage')
  async convert(@Param('id') id: string, @Body() body: { type?: unknown; title?: unknown; description?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.convertTicket.execute({ conversationId: id, agentId: adminOf(request), type: body?.type, title: body?.title, description: body?.description });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @Get('after-sales/tickets')
  @RequirePermissions('agent:manage')
  async tickets(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(50, Number(query.pageSize ?? 10) || 10);
    const result = await this.deps.tickets.listAdmin({ status: query.status ?? null, page, pageSize });
    return { data: { items: result.items.map((t) => ({ id: (t.state as { ticketId: string }).ticketId, type: (t.state as { type: string }).type, status: (t.state as { status: string }).status, title: (t.state as { title: string }).title, createdAt: (t.state as { createdAt: Date }).createdAt })), page, pageSize, total: result.total }, requestId: request.requestId };
  }

  @Get('after-sales/tickets/:id')
  @RequirePermissions('agent:manage')
  async ticket(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const ticket = await this.deps.tickets.findById(id);
    if (!ticket) throw new ApplicationError('NOT_FOUND', '工单不存在');
    const actions = await this.deps.tickets.listActions(id);
    return { data: { ticket: ticket.state, actions }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/accept')
  @RequirePermissions('agent:manage')
  async acceptTicket(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.process.execute({ ticketId: id, action: 'accept', adminId: adminOf(request) });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/reply')
  @RequirePermissions('agent:manage')
  async replyTicket(@Param('id') id: string, @Body() body: { text?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.process.execute({ ticketId: id, action: 'reply', adminId: adminOf(request), detail: { text: body?.text ?? '' } });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/refund')
  @RequirePermissions('agent:manage')
  async refundTicket(@Param('id') id: string, @Body() body: { orderId?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.refund.execute({ ticketId: id, orderId: body?.orderId, adminId: adminOf(request), requestId: request.requestId });
    return { data: { refundId: result.refundId }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/resolve')
  @RequirePermissions('agent:manage')
  async resolveTicket(@Param('id') id: string, @Body() body: { reply?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.process.execute({ ticketId: id, action: 'resolve', adminId: adminOf(request), detail: { reply: body?.reply ?? '' } });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

  @Post('after-sales/tickets/:id/close')
  @RequirePermissions('agent:manage')
  async closeTicket(@Param('id') id: string, @Body() body: { reason?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const result = await this.deps.process.execute({ ticketId: id, action: 'close', adminId: adminOf(request), detail: { reason: body?.reason ?? '' } });
    return { data: { ticket: { id: result.ticket.state.ticketId, status: result.ticket.state.status } }, requestId: request.requestId };
  }

}
