import { ApplicationError, type Clock } from '../../../shared/kernel';
import { Conversation } from '../domain/conversation';

export interface AgentConversationRepository {
  findByIdForUpdate(id: string, sessionTx?: unknown): Promise<Conversation | null>;
  save(conversation: Conversation, sessionTx?: unknown): Promise<void>;
  listQueue(limit: number): Promise<Conversation[]>;
  listByAgent(agentId: string, statuses: string[]): Promise<Conversation[]>;
}

export interface AgentPresencePort {
  isEligible(agentId: string, now: Date, sessionTx: unknown): Promise<boolean>;
  heartbeat(agentId: string, now: Date, sessionTx: unknown): Promise<void>;
  dispatchQueued(now: Date, sessionTx: unknown): Promise<void>;
}

export class AgentHeartbeatUseCase {
  constructor(private readonly deps: { presence: AgentPresencePort; runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> }; clock: Clock }) {}
  async execute(agentId: string): Promise<void> {
    await this.deps.runner.run(async tx => {
      const now = this.deps.clock.now();
      await this.deps.presence.heartbeat(agentId, now, tx);
      await this.deps.presence.dispatchQueued(now, tx);
    });
  }
}

/** 接入：queued→active；并发恰一人成功（行锁+状态条件更新）。 */
export class AcceptConversationUseCase {
  constructor(private readonly deps: { conversations: AgentConversationRepository; runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> }; clock: Clock }) {}

  async execute(input: { conversationId: unknown; agentId: unknown }): Promise<{ conversation: Conversation }> {
    const conversationId = typeof input.conversationId === 'string' ? input.conversationId : '';
    const agentId = typeof input.agentId === 'string' ? input.agentId : '';
    if (!conversationId || !agentId) throw new ApplicationError('VALIDATION_FAILED', '参数非法');
    return this.deps.runner.run(async (sessionTx) => {
      const conversation = await this.deps.conversations.findByIdForUpdate(conversationId, sessionTx);
      if (!conversation) throw new ApplicationError('NOT_FOUND', '会话不存在');
      const accepted = conversation.accept(agentId, this.deps.clock.now());
      await this.deps.conversations.save(accepted, sessionTx);
      return { conversation: accepted };
    });
  }
}

/** 转接：active 内换客服。 */
export class TransferConversationUseCase {
  constructor(private readonly deps: { conversations: AgentConversationRepository; presence: Pick<AgentPresencePort, 'isEligible'>; runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> }; clock: Clock; audit?: { execute(entry: Record<string, unknown>, sessionTx?: unknown): Promise<void> } }) {}

  async execute(input: { conversationId: unknown; agentId: unknown; targetAgentId: unknown }): Promise<{ conversation: Conversation }> {
    const conversationId = typeof input.conversationId === 'string' ? input.conversationId : '';
    const agentId = String(input.agentId ?? '');
    const targetAgentId = typeof input.targetAgentId === 'string' ? input.targetAgentId : '';
    if (!conversationId || !targetAgentId || targetAgentId === agentId) throw new ApplicationError('VALIDATION_FAILED', '转接参数非法');
    return this.deps.runner.run(async (sessionTx) => {
      const conversation = await this.deps.conversations.findByIdForUpdate(conversationId, sessionTx);
      if (!conversation) throw new ApplicationError('NOT_FOUND', '会话不存在');
      if (!conversation.isAssignedTo(agentId)) throw new ApplicationError('FORBIDDEN', '会话未分配给您');
      if (!await this.deps.presence.isEligible(targetAgentId, this.deps.clock.now(), sessionTx)) throw new ApplicationError('AGENT_NOT_ONLINE', '目标客服未在线或无接待权限');
      const transferred = conversation.reassign(targetAgentId, this.deps.clock.now());
      await this.deps.conversations.save(transferred, sessionTx);
      if (this.deps.audit) {
        await this.deps.audit?.execute({ adminId: agentId, action: 'cs.transfer', resourceType: 'cs_conversation', resourceId: conversationId, requestId: null, detail: { to: targetAgentId } }, sessionTx);
      }
      return { conversation: transferred };
    });
  }
}

/** 结束（客服/用户共用逻辑在控制器分发）；converted/ended 幂等。 */
export class EndConversationUseCase {
  constructor(private readonly deps: { conversations: AgentConversationRepository; runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> }; clock: Clock }) {}

  async execute(input: { conversationId: unknown; userId?: unknown; agentId?: unknown }): Promise<{ conversation: Conversation }> {
    return this.deps.runner.run(async (sessionTx) => {
      const conversation = await this.deps.conversations.findByIdForUpdate(String(input.conversationId ?? ''), sessionTx);
      if (!conversation) throw new ApplicationError('NOT_FOUND', '会话不存在');
      if (input.userId !== undefined && conversation.state.userId !== input.userId) throw new ApplicationError('NOT_FOUND', '会话不存在');
      if (input.agentId !== undefined && !conversation.canRead(String(input.agentId))) throw new ApplicationError('NOT_FOUND', '会话不存在');
      const ended = conversation.end(this.deps.clock.now());
      await this.deps.conversations.save(ended, sessionTx);
      return { conversation: ended };
    });
  }
}
