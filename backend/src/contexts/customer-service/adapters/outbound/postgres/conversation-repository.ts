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
  actor_id: string | null;
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
    actorId: row.actor_id,
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

  async lockUser(userId: string, sessionTx: unknown): Promise<void> {
    await this.queryIn(sessionTx, client => client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]));
  }

  async isEligible(agentId: string, now: Date, sessionTx: unknown): Promise<boolean> {
    return this.queryIn(sessionTx, async client => {
      const { rows } = await client.query(`SELECT a.id FROM admins a JOIN cs_agent_presence p ON p.agent_id = a.id WHERE a.id = $1 AND a.status = 'active' AND a.role IN ('super_admin','cs_agent','cs_supervisor') AND p.heartbeat_at > $2::timestamptz - interval '60 seconds'`, [agentId, now]);
      return rows.length > 0;
    });
  }

  async heartbeat(agentId: string, now: Date, sessionTx: unknown): Promise<void> {
    await this.queryIn(sessionTx, client => client.query(`INSERT INTO cs_agent_presence (agent_id, heartbeat_at) VALUES ($1,$2) ON CONFLICT (agent_id) DO UPDATE SET heartbeat_at = EXCLUDED.heartbeat_at`, [agentId, now]));
  }

  async dispatchQueued(now: Date, sessionTx: unknown): Promise<void> {
    await this.queryIn(sessionTx, async client => {
      // 分配共享锁只在此短事务持有；每次选人实时重算接待量。
      await client.query("SELECT pg_advisory_xact_lock(hashtext('cs.dispatch'))");
      const { rows: queued } = await client.query<{ id: string }>("SELECT id FROM cs_conversations WHERE status = 'queued' ORDER BY created_at, id LIMIT 100 FOR UPDATE");
      for (const conversation of queued) {
        const { rows: candidates } = await client.query<{ id: string }>(`SELECT a.id FROM admins a JOIN cs_agent_presence p ON p.agent_id = a.id WHERE a.status = 'active' AND a.role IN ('super_admin','cs_agent','cs_supervisor') AND p.heartbeat_at > $1::timestamptz - interval '60 seconds' ORDER BY (SELECT COUNT(*) FROM cs_conversations c WHERE c.assigned_agent_id = a.id AND c.status = 'active'), p.heartbeat_at DESC, a.id LIMIT 1`, [now]);
        if (!candidates[0]) break;
        await client.query("UPDATE cs_conversations SET status = 'active', assigned_agent_id = $2, updated_at = $3 WHERE id = $1 AND status = 'queued'", [conversation.id, candidates[0].id, now]);
      }
      await client.query(`UPDATE cs_agent_presence p SET active_count = (SELECT COUNT(*) FROM cs_conversations c WHERE c.assigned_agent_id = p.agent_id AND c.status = 'active')`);
    });
  }

  async listOnline(): Promise<Array<{ id: string; displayName: string; activeCount: number }>> {
    return this.query(async client => {
      const { rows } = await client.query<{ id: string; display_name: string; count: string }>(`SELECT a.id, a.display_name, (SELECT COUNT(*) FROM cs_conversations c WHERE c.assigned_agent_id = a.id AND c.status = 'active') AS count FROM admins a JOIN cs_agent_presence p ON p.agent_id = a.id WHERE a.status = 'active' AND a.role IN ('super_admin','cs_agent','cs_supervisor') AND p.heartbeat_at > now() - interval '60 seconds' ORDER BY a.display_name`);
      return rows.map(r => ({id:r.id,displayName:r.display_name,activeCount:Number(r.count)}));
    });
  }

  async listByUser(userId: string, page: number, pageSize: number): Promise<{ items: Conversation[]; total: number }> {
    return this.query(async client => {
      const {rows} = await client.query<ConversationRow>(`SELECT ${COLUMNS} FROM cs_conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [userId,pageSize,(page-1)*pageSize]);
      const count = await client.query<{count:string}>('SELECT COUNT(*) FROM cs_conversations WHERE user_id = $1',[userId]);
      return {items:rows.map(conversationOf),total:Number(count.rows[0]?.count??0)};
    });
  }

  async acknowledge(conversationId: string, actorId: string, seq: number): Promise<void> {
    await this.query(client => client.query(`INSERT INTO cs_read_marks (conversation_id,actor_id,last_read_seq) VALUES ($1,$2,$3) ON CONFLICT (conversation_id,actor_id) DO UPDATE SET last_read_seq = GREATEST(cs_read_marks.last_read_seq,EXCLUDED.last_read_seq), updated_at=now()`,[conversationId,actorId,seq]));
  }

  async findLastSeq(conversationId: string, sessionTx?: unknown): Promise<number> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<{ last: number | null }>(`SELECT MAX(seq) AS last FROM cs_messages WHERE conversation_id = $1`, [conversationId]);
      return Number(rows[0]?.last ?? 0);
    });
  }

  async findDuplicate(conversationId: string, clientMessageId: string, sender: MessageState['sender'], actorId: string, sessionTx?: unknown): Promise<MessageState | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<MessageRow>(
        `SELECT id, conversation_id, seq, sender, actor_id, kind, content, internal, client_message_id, created_at
         FROM cs_messages WHERE conversation_id = $1 AND client_message_id = $2 AND sender = $3 AND actor_id = $4 LIMIT 1`,
        [conversationId, clientMessageId, sender, actorId]
      );
      return rows[0] ? messageOf(rows[0]) : null;
    });
  }

  async insertMessage(message: MessageState, sessionTx?: unknown): Promise<void> {
    await this.queryIn(sessionTx, (client) => client.query(
      `INSERT INTO cs_messages (id, conversation_id, seq, sender, kind, content, internal, client_message_id, created_at, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [message.messageId, message.conversationId, message.seq, message.sender, message.kind, JSON.stringify(message.content), message.internal, message.clientMessageId, message.createdAt, message.actorId]
    ));
  }

  async listMessages(conversationId: string, afterSeq: number, limit: number, includeInternal = false): Promise<MessageState[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<MessageRow>(
        `SELECT id, conversation_id, seq, sender, actor_id, kind, content, internal, client_message_id, created_at
         FROM cs_messages WHERE conversation_id = $1 AND seq > $2 AND ($4 OR NOT internal) ORDER BY seq ASC LIMIT $3`,
        [conversationId, afterSeq, limit, includeInternal]
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

  async listByAgent(agentId: string, statuses: string[], page=1,pageSize=50): Promise<Conversation[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<ConversationRow>(
        `SELECT ${COLUMNS} FROM cs_conversations WHERE assigned_agent_id = $1 AND status = ANY($2::varchar[]) ORDER BY updated_at DESC, id DESC LIMIT $3 OFFSET $4`,
        [agentId, statuses,pageSize,(page-1)*pageSize]
      );
      return rows.map(conversationOf);
    });
  }
  async countByAgent(agentId:string,statuses:string[]):Promise<number>{return this.query(async c=>{const {rows}=await c.query<{count:string}>('SELECT COUNT(*) FROM cs_conversations WHERE assigned_agent_id=$1 AND status=ANY($2::varchar[])',[agentId,statuses]);return Number(rows[0]?.count??0);});}
}
