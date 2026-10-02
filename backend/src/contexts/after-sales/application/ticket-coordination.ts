import { ApplicationError, type Clock } from '../../../shared/kernel';
import { Ticket } from '../domain/ticket';
import type { Conversation } from '../../customer-service/domain/conversation';
import type { TicketRepository, AfterSalesRefundPort } from './ticket-usecases';

/** 售后协调（D017）：退款经支付公开用例（资格+额度校验），action 与结果同事务记录；失败回滚无半条。 */
export class RequestTicketRefundUseCase {
  constructor(private readonly deps: {
    tickets: Pick<TicketRepository, 'findByIdForUpdate' | 'save' | 'insertAction'>;
    refundPort: AfterSalesRefundPort;
    audit?: {execute(entry:Record<string,unknown>,tx:unknown):Promise<void>};
    runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
    clock: Clock;
  }) {}

  async execute(input: { ticketId: unknown; orderId: unknown; adminId: unknown; requestId: unknown }): Promise<{ refundId: string }> {
    const ticketId = String(input.ticketId ?? '');
    const orderId = String(input.orderId ?? '');
    if (!ticketId || !orderId) throw new ApplicationError('VALIDATION_FAILED', '参数非法');
    // 工单事务：状态校验 + 创建全额退款（公开用例）+ action + 关联记录
    return this.deps.runner.run(async (sessionTx) => {
      const ticket = await this.deps.tickets.findByIdForUpdate(ticketId, sessionTx);
      if (!ticket) throw new ApplicationError('NOT_FOUND', '工单不存在');
      if (ticket.state.relatedOrderId !== orderId) throw new ApplicationError('NOT_FOUND', '工单关联订单不一致');
      if (ticket.state.relatedRefundId) return { refundId: ticket.state.relatedRefundId };
      if (ticket.state.status !== 'processing') {
        throw new ApplicationError('TICKET_STATE_CONFLICT', '工单受理后才能发起退款');
      }
      const userId = ticket.state.userId;
      const eligibility = await this.deps.refundPort.checkRefundable({ orderId, userId }, sessionTx);
      if (!eligibility.refundable) throw new ApplicationError('REFUND_NOT_ALLOWED', eligibility.reason ?? '订单不可退款');
      const { refundId } = await this.deps.refundPort.createFullRefund({ orderId, userId, reason: `售后工单 ${ticketId}` }, sessionTx);
      const updated = ticket.recordRefund(refundId, this.deps.clock.now());
      await this.deps.tickets.save(updated, sessionTx);
      await this.deps.tickets.insertAction(ticketId, {
        action: 'request_refund', actorType: 'admin', actorId: String(input.adminId ?? ''),
        detail: { orderId, refundId }, createdAt: this.deps.clock.now()
      }, sessionTx);
      await this.deps.audit?.execute({adminId:String(input.adminId),action:'ticket.refund',resourceType:'after_sales_ticket',resourceId:ticketId,requestId:String(input.requestId??''),detail:{orderId,refundId}},sessionTx);
      return { refundId };
    });
  }
}

/** 会话转工单：open 工单 + 会话 converted（同事务）。 */
export class ConvertConversationToTicketUseCase {
  constructor(private readonly deps: {
    tickets: Pick<TicketRepository, 'insert' | 'insertAction'>;
    conversations: { findByIdForUpdate(id: string, sessionTx?: unknown): Promise<Conversation | null>; save(c: Conversation, sessionTx?: unknown): Promise<void> };
    audit?: {execute(entry:Record<string,unknown>,tx:unknown):Promise<void>};
    references?: { assertOwned(input: { userId:string;orderId:string|null;groupId:string|null;conversationId:string|null }, tx:unknown):Promise<void> };
    runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
    clock: Clock;
  }) {}

  async execute(input: { conversationId: unknown; agentId: unknown; type: unknown; title: unknown; description: unknown; orderId?:unknown }): Promise<{ ticket: Ticket }> {
    return this.deps.runner.run(async (sessionTx) => {
      const conversation = await this.deps.conversations.findByIdForUpdate(String(input.conversationId ?? ''), sessionTx);
      if (!conversation) throw new ApplicationError('NOT_FOUND', '会话不存在');
      if (!conversation.isAssignedTo(String(input.agentId ?? ''))) throw new ApplicationError('NOT_FOUND', '会话不存在');
      const orderId=typeof input.orderId==='string'&&input.orderId?input.orderId:null;
      if(orderId){if(!this.deps.references)throw new ApplicationError('DEPENDENCY_UNAVAILABLE','订单归属校验不可用');await this.deps.references.assertOwned({userId:conversation.state.userId,orderId,groupId:null,conversationId:null},sessionTx);}
      const ticket = Ticket.create({
        userId: conversation.state.userId,
        type: String(input.type ?? ''),
        title: String(input.title ?? ''),
        description: String(input.description ?? ''),
        conversationId: String(input.conversationId ?? ''),
        relatedOrderId:orderId,
        now: this.deps.clock.now()
      });
      await this.deps.tickets.insert(ticket, sessionTx);
      await this.deps.tickets.insertAction(ticket.state.ticketId, { action: 'create', actorType: 'agent', actorId: String(input.agentId ?? ''), detail: { fromConversation: input.conversationId }, createdAt: this.deps.clock.now() }, sessionTx);
      const converted = conversation.convertToTicket(ticket.state.ticketId, this.deps.clock.now());
      await this.deps.conversations.save(converted, sessionTx);
      await this.deps.audit?.execute({adminId:String(input.agentId),action:'cs.convert_ticket',resourceType:'cs_conversation',resourceId:String(input.conversationId),requestId:null,detail:{ticketId:ticket.state.ticketId}},sessionTx);
      return { ticket };
    });
  }
}
