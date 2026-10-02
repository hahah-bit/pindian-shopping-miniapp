import { ApplicationError } from '../../../shared/kernel';

export type ConversationStatus = 'queued' | 'active' | 'ended' | 'converted';
export type MessageKind = 'text' | 'image' | 'card' | 'note';

export interface ConversationState {
  conversationId: string;
  userId: string;
  status: ConversationStatus;
  assignedAgentId: string | null;
  ticketId: string | null;
  lastSeq: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageState {
  messageId: string;
  conversationId: string;
  seq: number;
  sender: 'user' | 'agent' | 'system';
  actorId: string | null;
  kind: MessageKind;
  content: Record<string, unknown>;
  internal: boolean;
  clientMessageId: string | null;
  createdAt: Date;
}

/** 会话聚合（T008）：状态机 queued→active→ended/converted；消息追加与 seq/幂等由仓储在事务内保障。 */
export class Conversation {
  private constructor(readonly state: ConversationState) {}

  static rehydrate(state: ConversationState): Conversation {
    return new Conversation({ ...state });
  }

  static create(input: { conversationId?: string; userId: string; now: Date; status?: ConversationStatus; assignedAgentId?: string | null }): Conversation {
    if (!input.userId) throw new ApplicationError('VALIDATION_FAILED', '用户身份缺失');
    return new Conversation({
      conversationId: input.conversationId ?? crypto.randomUUID(),
      userId: input.userId,
      status: input.status ?? 'queued',
      assignedAgentId: input.assignedAgentId ?? null,
      ticketId: null,
      lastSeq: 0,
      createdAt: input.now,
      updatedAt: input.now
    });
  }

  get isOpen(): boolean {
    return this.state.status === 'queued' || this.state.status === 'active';
  }

  /** 客服接入：仅 queued；active 内转接用 reassign。 */
  accept(agentId: string, now: Date): Conversation {
    if (this.state.status !== 'queued') throw new ApplicationError('CONVERSATION_NOT_QUEUED', '会话已被接入或已结束');
    return new Conversation({ ...this.state, status: 'active', assignedAgentId: agentId, updatedAt: now });
  }

  /** 转接：active 内更换客服。 */
  reassign(agentId: string, now: Date): Conversation {
    if (this.state.status !== 'active') throw new ApplicationError('CONVERSATION_NOT_QUEUED', '会话不在接待中，无法转接');
    return new Conversation({ ...this.state, assignedAgentId: agentId, updatedAt: now });
  }

  /** 追加消息：仅开放会话；返回新聚合（lastSeq+1）。消息实体由用例构造持久化。 */
  appendMessage(now: Date): Conversation {
    if (!this.isOpen) throw new ApplicationError('CONVERSATION_ENDED', '会话已结束，不能发送消息');
    return new Conversation({ ...this.state, lastSeq: this.state.lastSeq + 1, updatedAt: now });
  }

  /** 客服可见性：分配给自己的会话；用户可见性由用例按 userId 校验。 */
  isAssignedTo(agentId: string): boolean {
    return this.state.status === 'active' && this.state.assignedAgentId === agentId;
  }

  canRead(agentId: string): boolean {
    return this.state.assignedAgentId === agentId;
  }

  end(now: Date): Conversation {
    if (!this.isOpen) return this; // 幂等
    return new Conversation({ ...this.state, status: 'ended', updatedAt: now });
  }

  convertToTicket(ticketId: string, now: Date): Conversation {
    if (!this.isOpen) throw new ApplicationError('CONVERSATION_ENDED', '会话已结束，不能转工单');
    return new Conversation({ ...this.state, status: 'converted', ticketId, updatedAt: now });
  }
}
