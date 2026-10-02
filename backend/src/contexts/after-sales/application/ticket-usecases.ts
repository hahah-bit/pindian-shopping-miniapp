import { ApplicationError, type Clock } from '../../../shared/kernel';
import { Ticket, type TicketActionData, type TicketActionType } from '../domain/ticket';

export interface TicketRepository {
  insert(ticket: Ticket, sessionTx?: unknown): Promise<void>;
  save(ticket: Ticket, sessionTx?: unknown): Promise<void>;
  findByIdForUpdate(id: string, sessionTx?: unknown): Promise<Ticket | null>;
  findById(id: string): Promise<Ticket | null>;
  insertAction(ticketId: string, action: TicketActionData, sessionTx?: unknown): Promise<void>;
}

/** 资格/额度校验 + 全额退款创建（支付域公开用例端口；实现经 Foundation 装配衔接 T006）。 */
export interface AfterSalesRefundPort {
  checkRefundable(input: { orderId: string }): Promise<{ refundable: boolean; reason?: string }>;
  createFullRefund(input: { orderId: string; reason: string }): Promise<{ refundId: string }>;
}

export interface CreateTicketDeps {
  tickets: Pick<TicketRepository, 'insert' | 'insertAction'>;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}

/** 创建工单（会话转工单/用户直接提交共用）。 */
export class CreateTicketUseCase {
  constructor(private readonly deps: CreateTicketDeps) {}

  async execute(input: { userId: unknown; type: unknown; title: unknown; description: unknown; orderId?: unknown; groupId?: unknown; conversationId?: unknown }): Promise<{ ticket: Ticket }> {
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
      await this.deps.tickets.insert(ticket, sessionTx);
      await this.deps.tickets.insertAction(ticket.state.ticketId, { action: 'create', actorType: 'user', actorId: ticket.state.userId, detail: {}, createdAt: this.deps.clock.now() }, sessionTx);
      return { ticket };
    });
  }
}

export interface ProcessTicketDeps {
  tickets: Pick<TicketRepository, 'findByIdForUpdate' | 'save' | 'insertAction'>;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}

const PROCESS_ACTIONS: ReadonlySet<string> = new Set(['accept', 'reply', 'request_feedback', 'resolve', 'close', 'user_feedback']);

/** 受理/回复/请求反馈/解决/关闭（状态机 + actions 只追加；close 幂等）。 */
export class ProcessTicketUseCase {
  constructor(private readonly deps: ProcessTicketDeps) {}

  async execute(input: { ticketId: unknown; action: unknown; adminId?: unknown; userId?: unknown; detail?: unknown }): Promise<{ ticket: Ticket }> {
    const ticketId = String(input.ticketId ?? '');
    const action = String(input.action ?? '') as TicketActionType;
    if (!PROCESS_ACTIONS.has(action)) throw new ApplicationError('VALIDATION_FAILED', '工单动作非法');
    const detail = (input.detail ?? {}) as Record<string, unknown>;
    return this.deps.runner.run(async (sessionTx) => {
      const ticket = await this.deps.tickets.findByIdForUpdate(ticketId, sessionTx);
      if (!ticket) throw new ApplicationError('NOT_FOUND', '工单不存在');
      // 归属校验：用户动作仅限本人工单（他人一律 404）
      if (action === 'user_feedback' && typeof input.userId === 'string' && input.userId && ticket.state.userId !== input.userId) {
        throw new ApplicationError('NOT_FOUND', '工单不存在');
      }
      const now = this.deps.clock.now();
      if (action === 'close' && ticket.state.status === 'closed') {
        return { ticket }; // 幂等
      }
      let updated = ticket;
      if (action === 'accept' || action === 'reply' || action === 'request_feedback' || action === 'resolve' || action === 'close') {
        const next = action === 'accept' ? 'processing' : action === 'resolve' ? 'resolved' : action === 'close' ? 'closed' : 'processing';
        updated = ticket.transition(next, now);
        await this.deps.tickets.save(updated, sessionTx);
      }
      const actorType = action === 'user_feedback' ? 'user' : 'admin';
      const actorId = actorType === 'user' ? String(input.userId ?? updated.state.userId) : String(input.adminId ?? '');
      await this.deps.tickets.insertAction(ticketId, { action, actorType, actorId, detail, createdAt: now }, sessionTx);
      return { ticket: updated };
    });
  }
}
