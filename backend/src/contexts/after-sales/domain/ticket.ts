import { ApplicationError, type Clock } from '../../../shared/kernel';

export type TicketStatus = 'open' | 'processing' | 'resolved' | 'closed';
export type TicketType = 'group_issue' | 'payment_issue' | 'refund_issue' | 'product_issue' | 'shipment_issue' | 'complaint' | 'other';
export type TicketActionType = 'create' | 'accept' | 'reply' | 'request_feedback' | 'request_refund' | 'request_reshipment' | 'resolve' | 'close' | 'user_feedback';

export const TICKET_TYPES: ReadonlySet<string> = new Set(['group_issue', 'payment_issue', 'refund_issue', 'product_issue', 'shipment_issue', 'complaint', 'other']);

export interface TicketState {
  ticketId: string;
  userId: string;
  conversationId: string | null;
  type: TicketType;
  status: TicketStatus;
  title: string;
  description: string;
  relatedOrderId: string | null;
  relatedGroupId: string | null;
  relatedRefundId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketActionData {
  action: TicketActionType;
  actorType: 'user' | 'agent' | 'admin' | 'system';
  actorId: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
}

/** 售后工单聚合（T008）：状态机 open→processing→resolved/closed；actions 只追加；终态拒绝处理。 */
export class Ticket {
  private constructor(readonly state: TicketState) {}

  static rehydrate(state: TicketState): Ticket {
    return new Ticket({ ...state });
  }

  static create(input: {
    ticketId?: string; userId: string; conversationId?: string | null; type: string;
    title: string; description: string; relatedOrderId?: string | null; relatedGroupId?: string | null; now: Date; status?: TicketStatus;
  }): Ticket {
    if (!TICKET_TYPES.has(input.type)) throw new ApplicationError('VALIDATION_FAILED', '工单类型非法');
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || title.length > 60) throw new ApplicationError('VALIDATION_FAILED', '标题 1-60 字');
    if (!description || description.length > 2000) throw new ApplicationError('VALIDATION_FAILED', '描述 1-2000 字');
    return new Ticket({
      ticketId: input.ticketId ?? crypto.randomUUID(),
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      type: input.type as TicketType,
      status: input.status ?? 'open',
      title,
      description,
      relatedOrderId: input.relatedOrderId ?? null,
      relatedGroupId: input.relatedGroupId ?? null,
      relatedRefundId: null,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  /** 状态迁移（actions 只追加由用例记录）。resolved/closed 终态（close 幂等由用例处理）。 */
  transition(next: 'processing' | 'resolved' | 'closed', now: Date): Ticket {
    if (this.state.status === 'resolved' || this.state.status === 'closed') {
      throw new ApplicationError('TICKET_STATE_CONFLICT', `工单已${this.state.status === 'resolved' ? '解决' : '关闭'}，不能变更`);
    }
    if (next === 'processing' && this.state.status !== 'open') throw new ApplicationError('TICKET_STATE_CONFLICT', '仅待处理工单可受理');
    return new Ticket({ ...this.state, status: next, updatedAt: now });
  }

  recordRefund(refundId: string, now: Date): Ticket {
    return new Ticket({ ...this.state, relatedRefundId: refundId, updatedAt: now });
  }
}
