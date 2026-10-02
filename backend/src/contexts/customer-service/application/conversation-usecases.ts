import { ApplicationError, type Clock } from '../../../shared/kernel';
import { Conversation, type MessageKind, type MessageState } from '../domain/conversation';
import { randomUUID } from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export interface ConversationRepository {
  insert(conversation: Conversation, sessionTx?: unknown): Promise<void>;
  save(conversation: Conversation, sessionTx?: unknown): Promise<void>;
  findById(id: string, sessionTx?: unknown): Promise<Conversation | null>;
  findByIdForUpdate(id: string, sessionTx?: unknown): Promise<Conversation | null>;
  findOpenByUserId(userId: string, sessionTx?: unknown): Promise<Conversation | null>;
  /** 组内最大 seq（会话行锁内调用）。 */
  findLastSeq(conversationId: string, sessionTx?: unknown): Promise<number>;
  /** 幂等查重：同会话同 clientMessageId 的既有消息。 */
  findDuplicate(conversationId: string, clientMessageId: string, sender: MessageState['sender'], actorId: string, sessionTx?: unknown): Promise<MessageState | null>;
  insertMessage(message: MessageState, sessionTx?: unknown): Promise<void>;
}

export interface CreateConversationDeps {
  conversations: Pick<ConversationRepository, 'insert' | 'findOpenByUserId'> & { lockUser?(userId: string, sessionTx: unknown): Promise<void>; dispatchQueued?(now: Date, tx: unknown): Promise<void> };
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}

/** 发起/恢复会话：已有未结束会话幂等返回；否则 queued 入队（无人接入=留言）。 */
export class CreateConversationUseCase {
  constructor(private readonly deps: CreateConversationDeps) {}

  async execute(input: { userId: unknown }): Promise<{ conversation: Conversation }> {
    const userId = typeof input.userId === 'string' ? input.userId : '';
    if (!userId) throw new ApplicationError('VALIDATION_FAILED', '用户身份缺失');
    const conversation = await this.deps.runner.run(async (sessionTx) => {
      await this.deps.conversations.lockUser?.(userId, sessionTx);
      const existing = await this.deps.conversations.findOpenByUserId(userId, sessionTx);
      if (existing) return existing;
      const created = Conversation.create({ userId, now: this.deps.clock.now() });
      await this.deps.conversations.insert(created, sessionTx);
      await this.deps.conversations.dispatchQueued?.(this.deps.clock.now(), sessionTx);
      return await this.deps.conversations.findOpenByUserId(userId, sessionTx) ?? created;
    });
    return { conversation };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT_LENGTH = 2000;

export interface AppendMessageDeps {
  conversations: ConversationRepository;
  authorizeCard?: (userId: string, kind: string, id: string) => Promise<Record<string, unknown>>;
  authorizeImage?: (conversationId: string, id: string) => Promise<void>;
  runner: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> };
  clock: Clock;
}

/** 发送消息（用户/客服/备注共用）：seq=lastSeq+1；clientMessageId 幂等；ended 拒发；越权 NOT_FOUND。 */
export class AppendMessageUseCase {
  constructor(private readonly deps: AppendMessageDeps) {}

  async execute(input: {
    conversationId: unknown; userId?: unknown; agentId?: unknown; clientMessageId: unknown;
    kind: unknown; content: unknown; sender: 'user' | 'agent'; internal?: boolean;
  }): Promise<{ message: MessageState; conversation: Conversation; duplicated: boolean }> {
    const conversationId = typeof input.conversationId === 'string' && UUID_PATTERN.test(input.conversationId) ? input.conversationId : '';
    const clientMessageId = typeof input.clientMessageId === 'string' && input.clientMessageId.length >= 1 && input.clientMessageId.length <= 64 ? input.clientMessageId : '';
    if (!conversationId || !clientMessageId) throw new ApplicationError('VALIDATION_FAILED', '会话或客户端消息 ID 非法');
    const kind = input.kind as MessageKind;
    if (!['text', 'image', 'card', 'note'].includes(kind)) throw new ApplicationError('VALIDATION_FAILED', '消息类型非法');
    if (input.sender === 'user' && (kind === 'note' || input.internal)) throw new ApplicationError('VALIDATION_FAILED', '用户不能发送内部备注');
    const content = this.validateContent(kind, input.content);
    const actorId = String(input.sender === 'user' ? input.userId ?? '' : input.agentId ?? '');
    const internal = input.sender === 'agent' && (Boolean(input.internal) || kind === 'note');

    return this.deps.runner.run(async (sessionTx) => {
      const conversation = await this.deps.conversations.findByIdForUpdate(conversationId, sessionTx);
      if (!conversation) throw new ApplicationError('NOT_FOUND', '会话不存在');
      // 归属校验：用户本人 / 分配给该客服的会话
      if (input.sender === 'user') {
        if (conversation.state.userId !== input.userId) throw new ApplicationError('NOT_FOUND', '会话不存在');
      } else {
        if (!conversation.isAssignedTo(String(input.agentId))) throw new ApplicationError('NOT_FOUND', '会话不存在');
      }
      if (kind === 'card') {
        if (!this.deps.authorizeCard) throw new ApplicationError('DEPENDENCY_UNAVAILABLE', '卡片投影暂不可用');
        await this.deps.authorizeCard(conversation.state.userId, String(content.cardKind), String(content.cardRefId));
      }
      if (kind === 'image') {
        if (!this.deps.authorizeImage) throw new ApplicationError('DEPENDENCY_UNAVAILABLE', '图片检查暂不可用');
        await this.deps.authorizeImage(conversationId, String(content.mediaAssetId));
      }
      const duplicate = await this.deps.conversations.findDuplicate(conversationId, clientMessageId, input.sender, actorId, sessionTx);
      if (duplicate) {
        if (duplicate.sender !== input.sender || duplicate.internal !== internal || duplicate.kind !== kind || !isDeepStrictEqual(duplicate.content,content)) {
          throw new ApplicationError('MESSAGE_ID_CONFLICT', '客户端消息键已用于不同内容');
        }
        return { message: duplicate, conversation, duplicated: true };
      }
      const appending = conversation.appendMessage(this.deps.clock.now());
      const message: MessageState = {
        messageId: randomUUID(),
        conversationId,
        seq: appending.state.lastSeq,
        sender: input.sender,
        actorId,
        kind,
        content,
        internal,
        clientMessageId,
        createdAt: this.deps.clock.now()
      };
      await this.deps.conversations.insertMessage(message, sessionTx);
      await this.deps.conversations.save(appending, sessionTx);
      return { message, conversation: appending, duplicated: false };
    });
  }

  private validateContent(kind: MessageKind, content: unknown): Record<string, unknown> {
    const c = (content ?? {}) as Record<string, unknown>;
    if (kind === 'text') {
      const text = typeof c.text === 'string' ? c.text : '';
      if (!text.trim() || text.length > MAX_TEXT_LENGTH) throw new ApplicationError('VALIDATION_FAILED', '文本消息 1-2000 字');
      return { text };
    }
    if (kind === 'image') {
      if (typeof c.mediaAssetId !== 'string' || !UUID_PATTERN.test(c.mediaAssetId)) throw new ApplicationError('VALIDATION_FAILED', '图片消息需有效 mediaAssetId');
      return { mediaAssetId: c.mediaAssetId };
    }
    if (kind === 'card') {
      if (!['product', 'order', 'group', 'refund'].includes(String(c.cardKind))) throw new ApplicationError('VALIDATION_FAILED', '卡片类型非法');
      if (typeof c.cardRefId !== 'string' || !UUID_PATTERN.test(c.cardRefId)) throw new ApplicationError('VALIDATION_FAILED', '卡片引用非法');
      return { cardKind: c.cardKind, cardRefId: c.cardRefId };
    }
    // note
    const text = typeof c.text === 'string' ? c.text : '';
    if (!text.trim() || text.length > 1000) throw new ApplicationError('VALIDATION_FAILED', '备注 1-1000 字');
    return { text };
  }
}

/** 断线补取/分页：afterSeq 之后升序，≤limit。 */
export class ListMessagesUseCase {
  constructor(private readonly deps: { conversations: Pick<ConversationRepository, 'findById'>; listMessages: (conversationId: string, afterSeq: number, limit: number, includeInternal: boolean) => Promise<MessageState[]> }) {}

  async execute(input: { conversationId: unknown; userId?: unknown; agentId?: unknown; afterSeq?: unknown; limit?: unknown; includeInternal?: boolean }): Promise<{ messages: MessageState[]; lastSeq: number; nextSeq: number }> {
    const conversationId = typeof input.conversationId === 'string' ? input.conversationId : '';
    const conversation = await this.deps.conversations.findById(conversationId);
    if (!conversation) throw new ApplicationError('NOT_FOUND', '会话不存在');
    if (input.userId !== undefined && conversation.state.userId !== input.userId) throw new ApplicationError('NOT_FOUND', '会话不存在');
    if (input.agentId !== undefined && !conversation.canRead(String(input.agentId))) throw new ApplicationError('NOT_FOUND', '会话不存在');
    if (input.userId === undefined && input.agentId === undefined) throw new ApplicationError('NOT_FOUND', '会话不存在');
    const afterSeq = Number(input.afterSeq ?? 0);
    const limit = Number(input.limit ?? 50);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApplicationError('VALIDATION_FAILED', '消息分页参数非法');
    const includeInternal = input.agentId !== undefined && Boolean(input.includeInternal);
    const messages = await this.deps.listMessages(conversationId, afterSeq, limit, includeInternal);
    const visible = includeInternal ? messages : messages.filter(m => !m.internal);
    return { messages: visible, lastSeq: conversation.state.lastSeq, nextSeq: visible.at(-1)?.seq ?? afterSeq };
  }
}
