import type { PoolClient } from 'pg';
import { Conversation, type ConversationState, type MessageState } from '../../../domain/conversation';
import type { ConversationRepository } from '../../../application/conversation-usecases';
import type { AgentConversationRepository } from '../../../application/agent-usecases';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface ConversationRow {
  id: string;
  user_id: string;
  status: ConversationState['status'];
  assigned_agent_id: string | null;
  ticket_id: string | null;
  last_seq: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, user_id, status, assigned_agent_id, ticket_id, last_seq, created_at, updated_at`;

function conversationOf(row: ConversationRow): Conversation {
  return Conversation.rehydrate({
    conversationId: row.id,
    userId: row.user_id,
    status: row.status,
    assignedAgentId: row.assigned_agent_id,
    ticketId: row.ticket_id,
    lastSeq: row.last_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

interface MessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  sender: MessageState['sender'];
  kind: MessageState['kind'];
  content: Record<string, unknown>;
  internal: boolean;
  client_message_id: string | null;
  created_at: Date;
}

function messageOf(row: MessageRow): MessageState {
  return {
    messageId: row.id,
    conversationId: row.conversation_id,
    seq: row.seq,
    sender: row.sender,
    kind: row.kind,
    content: row.content,
    internal: row.internal,
    clientMessageId: row.client_message_id,
    createdAt: row.created_at
  };
}

export class PostgresConversationRepository implements ConversationRepository, AgentConversationRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  private async queryIn<T>(sessionTx: unknown, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (sessionTx) return withExecutor(sessionTx as PgExecutor, work);
    return this.query(work);
  }

  async insert(conversation: Conversation, sessionTx?: unknown): Promise<void> {
    const s = conversation.state;
    await this.queryIn(sessionTx, (client) => client.query(
      `INSERT INTO cs_conversations (id, user_id, status, assigned_agent_id, ticket_id, last_seq, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [s.conversationId, s.userId, s.status, s.assignedAgentId, s.ticketId, s.lastSeq, s.createdAt, s.updatedAt]
    ));
  }

  async save(conversation: Conversation, sessionTx?: unknown): Promise<void> {
    const s = conversation.state;
    await this.queryIn(sessionTx, (client) => client.query(
      `UPDATE cs_conversations SET status = $2, assigned_agent_id = $3, ticket_id = $4, last_seq = $5, updated_at = $6 WHERE id = $1`,
      [s.conversationId, s.status, s.assignedAgentId, s.ticketId, s.lastSeq, s.updatedAt]
    ));
  }

  private mapOne(rows: ConversationRow[]): Conversation | null {
    return rows[0] ? conversationOf(rows[0]) : null;
  }

  async findById(id: string, sessionTx?: unknown): Promise<Conversation | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<ConversationRow>(`SELECT ${COLUMNS} FROM cs_conversations WHERE id = $1`, [id]);
      return this.mapOne(rows);
    });
  }

  async findByIdForUpdate(id: string, sessionTx?: unknown): Promise<Conversation | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<ConversationRow>(`SELECT ${COLUMNS} FROM cs_conversations WHERE id = $1 FOR UPDATE`, [id]);
      return this.mapOne(rows);
    });
  }

  async findOpenByUserId(userId: string, sessionTx?: unknown): Promise<Conversation | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<ConversationRow>(
        `SELECT ${COLUMNS} FROM cs_conversations WHERE user_id = $1 AND status IN ('queued', 'active') ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      return this.mapOne(rows);
    });
  }

  async findLastSeq(conversationId: string, sessionTx?: unknown): Promise<number> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<{ last: number | null }>(`SELECT MAX(seq) AS last FROM cs_messages WHERE conversation_id = $1`, [conversationId]);
      return Number(rows[0]?.last ?? 0);
    });
  }

  async findDuplicate(conversationId: string, clientMessageId: string, sessionTx?: unknown): Promise<MessageState | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<MessageRow>(
        `SELECT id, conversation_id, seq, sender, kind, content, internal, client_message_id, created_at
         FROM cs_messages WHERE conversation_id = $1 AND client_message_id = $2 LIMIT 1`,
        [conversationId, clientMessageId]
      );
      return rows[0] ? messageOf(rows[0]) : null;
    });
  }

  async insertMessage(message: MessageState, sessionTx?: unknown): Promise<void> {
    await this.queryIn(sessionTx, (client) => client.query(
      `INSERT INTO cs_messages (id, conversation_id, seq, sender, kind, content, internal, client_message_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [message.messageId, message.conversationId, message.seq, message.sender, message.kind, JSON.stringify(message.content), message.internal, message.clientMessageId, message.createdAt]
    ));
  }

  async listMessages(conversationId: string, afterSeq: number, limit: number): Promise<MessageState[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<MessageRow>(
        `SELECT id, conversation_id, seq, sender, kind, content, internal, client_message_id, created_at
         FROM cs_messages WHERE conversation_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
        [conversationId, afterSeq, limit]
      );
      return rows.map(messageOf);
    });
  }

  /** 队列：queued 会话（等待时间升序）。 */
  async listQueue(limit: number): Promise<Conversation[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<ConversationRow>(
        `SELECT ${COLUMNS} FROM cs_conversations WHERE status = 'queued' ORDER BY updated_at ASC LIMIT $1`,
        [limit]
      );
      return rows.map(conversationOf);
    });
  }

  async listByAgent(agentId: string, statuses: string[]): Promise<Conversation[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<ConversationRow>(
        `SELECT ${COLUMNS} FROM cs_conversations WHERE assigned_agent_id = $1 AND status = ANY($2::varchar[]) ORDER BY updated_at DESC LIMIT 50`,
        [agentId, statuses]
      );
      return rows.map(conversationOf);
    });
  }
}
