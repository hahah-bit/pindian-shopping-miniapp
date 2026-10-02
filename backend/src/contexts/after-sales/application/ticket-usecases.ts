import { ApplicationError, type Clock } from '../../../shared/kernel';
import { Ticket, type TicketActionData, type TicketActionType } from '../domain/ticket';
import {isDeepStrictEqual} from 'node:util';

export interface TicketRepository {
  insert(ticket: Ticket, sessionTx?: unknown, clientTicketId?: string): Promise<void>;
  findByClientKey?(userId: string, key: string, tx: unknown): Promise<Ticket | null>;
  save(ticket: Ticket, sessionTx?: unknown): Promise<void>;
  findByIdForUpdate(id: string, sessionTx?: unknown): Promise<Ticket | null>;
  findById(id: string): Promise<Ticket | null>;
  insertAction(ticketId: string, action: TicketActionData, sessionTx?: unknown, clientActionId?:string): Promise<void>;
  findActionByClientKey?(ticketId:string,actorType:string,actorId:string,key:string,tx:unknown):Promise<TicketActionData|null>;
}

/** 资格/额度校验 + 全额退款创建（支付域公开用例端口；实现经 Foundation 装配衔接 T006）。 */
export interface AfterSalesRefundPort {
  checkRefundable(input: { orderId: string; userId: string }, sessionTx: unknown): Promise<{ refundable: boolean; reason?: string }>;
  createFullRefund(input: { orderId: string; userId: string; reason: string }, sessionTx: unknown): Promise<{ refundId: string }>;
}

export interface CreateTicketDeps {
  tickets: Pick<TicketRepository, 'insert' | 'insertAction' | 'findByClientKey'>;
  references: { assertOwned(input: { userId: string; orderId: string | null; groupId: string | null; conversationId: string | null }, sessionTx: unknown): Promise<void> };
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}

/** 创建工单（会话转工单/用户直接提交共用）。 */
export class CreateTicketUseCase {
  constructor(private readonly deps: CreateTicketDeps) {}

  async execute(input: { userId: unknown; type: unknown; title: unknown; description: unknown; orderId?: unknown; groupId?: unknown; conversationId?: unknown; clientTicketId?:unknown }): Promise<{ ticket: Ticket }> {
    const key=input.clientTicketId;
    if(key!==undefined&&(typeof key!=='string'||!key.trim()||key.length>64))throw new ApplicationError('VALIDATION_FAILED','工单客户端键非法');
    const ticket = Ticket.create({
      userId: String(input.userId ?? ''),
      type: String(input.type ?? ''),
      title: String(input.title ?? ''),
      description: String(input.description ?? ''),
      relatedOrderId: typeof input.orderId === 'string' ? input.orderId : null,
      relatedGroupId: typeof input.groupId === 'string' ? input.groupId : null,
      conversationId: typeof input.conversationId === 'string' ? input.conversationId : null,
      now: this.deps.clock.now()
    });
    return this.deps.runner.run(async (sessionTx) => {
      await this.deps.references.assertOwned({ userId: ticket.state.userId, orderId: ticket.state.relatedOrderId, groupId: ticket.state.relatedGroupId, conversationId: ticket.state.conversationId }, sessionTx);
      if(typeof key==='string'){
        if(!this.deps.tickets.findByClientKey)throw new ApplicationError('DEPENDENCY_UNAVAILABLE','工单幂等存储不可用');
        const duplicate=await this.deps.tickets.findByClientKey(ticket.state.userId,key,sessionTx);
        if(duplicate){const d=duplicate.state,s=ticket.state;if(d.type!==s.type||d.title!==s.title||d.description!==s.description||d.relatedOrderId!==s.relatedOrderId||d.relatedGroupId!==s.relatedGroupId||d.conversationId!==s.conversationId)throw new ApplicationError('IDEMPOTENCY_CONFLICT','工单客户端键已用于不同内容');return {ticket:duplicate};}
      }
      await this.deps.tickets.insert(ticket, sessionTx, typeof key==='string'?key:undefined);
      await this.deps.tickets.insertAction(ticket.state.ticketId, { action: 'create', actorType: 'user', actorId: ticket.state.userId, detail: {}, createdAt: this.deps.clock.now() }, sessionTx);
      return { ticket };
    });
  }
}

export interface ProcessTicketDeps {
  tickets: Pick<TicketRepository, 'findByIdForUpdate' | 'save' | 'insertAction' | 'findActionByClientKey'>;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
  audit?: { execute(entry: Record<string,unknown>, tx:unknown):Promise<void> };
}

const PROCESS_ACTIONS: ReadonlySet<string> = new Set(['accept', 'reply', 'request_feedback', 'resolve', 'close', 'user_feedback']);

/** 受理/回复/请求反馈/解决/关闭（状态机 + actions 只追加；close 幂等）。 */
export class ProcessTicketUseCase {
  constructor(private readonly deps: ProcessTicketDeps) {}

  async execute(input: { ticketId: unknown; action: unknown; adminId?: unknown; userId?: unknown; detail?: unknown; isSupervisor?: boolean;clientActionId?:unknown }): Promise<{ ticket: Ticket }> {
    const ticketId = String(input.ticketId ?? '');
    const action = String(input.action ?? '') as TicketActionType;
    if (!PROCESS_ACTIONS.has(action)) throw new ApplicationError('VALIDATION_FAILED', '工单动作非法');
    const key=input.clientActionId;
    if(key!==undefined&&(typeof key!=='string'||!key.trim()||key.length>64))throw new ApplicationError('VALIDATION_FAILED','动作客户端键非法');
    if(input.detail!==undefined&&(typeof input.detail!=='object'||input.detail===null||Array.isArray(input.detail)))throw new ApplicationError('VALIDATION_FAILED','动作内容非法');
    const detail = JSON.parse(JSON.stringify(input.detail??{})) as Record<string, unknown>;
    const actorType=action==='user_feedback'?'user':'admin';
    const actorId=String(actorType==='user'?input.userId??'':input.adminId??'');
    if(!actorId)throw new ApplicationError('UNAUTHENTICATED','处理人身份缺失');
    return this.deps.runner.run(async (sessionTx) => {
      const ticket = await this.deps.tickets.findByIdForUpdate(ticketId, sessionTx);
      if (!ticket) throw new ApplicationError('NOT_FOUND', '工单不存在');
      // 归属校验：用户动作仅限本人工单（他人一律 404）
      if (action === 'user_feedback' && (!input.userId || ticket.state.userId !== input.userId)) {
        throw new ApplicationError('NOT_FOUND', '工单不存在');
      }
      const now = this.deps.clock.now();
      if (action !== 'user_feedback' && action !== 'accept' && !input.isSupervisor && ticket.state.assignedAgentId !== input.adminId) throw new ApplicationError('NOT_FOUND', '工单未分配给您');
      if(typeof key==='string'){
        if(!this.deps.tickets.findActionByClientKey)throw new ApplicationError('DEPENDENCY_UNAVAILABLE','动作幂等存储不可用');
        const duplicate=await this.deps.tickets.findActionByClientKey(ticketId,actorType,actorId,key,sessionTx);
        if(duplicate){if(duplicate.action!==action||!isDeepStrictEqual(duplicate.detail,detail))throw new ApplicationError('IDEMPOTENCY_CONFLICT','动作客户端键已用于不同内容');return {ticket};}
      }
      if(action==='accept'&&ticket.state.assignedAgentId===actorId&&ticket.state.status!=='open')return {ticket};
      if (action === 'close' && ticket.state.status === 'closed') {
        return { ticket }; // 幂等
      }
      let updated = ticket;
      if (action === 'accept' && ticket.state.status !== 'open') throw new ApplicationError('TICKET_STATE_CONFLICT', '仅待处理工单可受理');
      if (action === 'reply' || action === 'request_feedback') {
        if (!['processing','waiting_feedback'].includes(ticket.state.status)) throw new ApplicationError('TICKET_STATE_CONFLICT', '工单受理后才能回复');
        if (typeof detail.text !== 'string' || !detail.text.trim() || detail.text.length > 2000) throw new ApplicationError('VALIDATION_FAILED', '回复 1-2000 字');
      }
      if (action === 'user_feedback') {
        if (!['resolved','waiting_feedback'].includes(ticket.state.status)) throw new ApplicationError('TICKET_STATE_CONFLICT', '工单请求反馈或解决后才能反馈');
        if (typeof detail.satisfied !== 'boolean' || (detail.text !== undefined && (typeof detail.text !== 'string' || detail.text.length > 2000))) throw new ApplicationError('VALIDATION_FAILED', '反馈参数非法');
        updated = detail.satisfied ? (ticket.state.status==='resolved'?ticket:ticket.transition('resolved',now)) : ticket.transition('processing', now);
        await this.deps.tickets.save(updated, sessionTx);
      }
      if (action === 'accept' || action === 'reply' || action === 'request_feedback' || action === 'resolve' || action === 'close') {
        const next = action === 'accept' ? 'processing' : action === 'resolve' ? 'resolved' : action === 'close' ? 'closed' : action === 'request_feedback' ? 'waiting_feedback' : 'processing';
        updated = ticket.transition(next, now);
        if (action === 'accept') updated = updated.assign(String(input.adminId));
        await this.deps.tickets.save(updated, sessionTx);
      }
      await this.deps.tickets.insertAction(ticketId, { action, actorType, actorId, detail, createdAt: now }, sessionTx,typeof key==='string'?key:undefined);
      if(actorType==='admin')await this.deps.audit?.execute({adminId:actorId,action:`ticket.${action}`,resourceType:'after_sales_ticket',resourceId:ticketId,requestId:null,detail:{status:updated.state.status}},sessionTx);
      return { ticket: updated };
    });
  }
}
