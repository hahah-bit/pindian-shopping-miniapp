import type { PoolClient } from 'pg';
import { Ticket, type TicketActionData, type TicketState } from '../../../domain/ticket';
import type { TicketRepository } from '../../../application/ticket-usecases';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

interface TicketRow {
  id: string;
  user_id: string;
  assigned_agent_id: string | null;
  conversation_id: string | null;
  type: TicketState['type'];
  status: TicketState['status'];
  title: string;
  description: string;
  related_order_id: string | null;
  related_group_id: string | null;
  related_refund_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, user_id, assigned_agent_id, conversation_id, type, status, title, description, related_order_id, related_group_id, related_refund_id, created_at, updated_at`;

function ticketOf(row: TicketRow): Ticket {
  return Ticket.rehydrate({
    ticketId: row.id,
    userId: row.user_id,
    assignedAgentId: row.assigned_agent_id,
    conversationId: row.conversation_id,
    type: row.type,
    status: row.status,
    title: row.title,
    description: row.description,
    relatedOrderId: row.related_order_id,
    relatedGroupId: row.related_group_id,
    relatedRefundId: row.related_refund_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

interface ActionRow {
  action: string;
  actor_type: string;
  actor_id: string | null;
  detail: Record<string, unknown>;
  created_at: Date;
}

export class PostgresTicketRepository implements TicketRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  private async queryIn<T>(sessionTx: unknown, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (sessionTx) return withExecutor(sessionTx as PgExecutor, work);
    return this.query(work);
  }

  async insert(ticket: Ticket, sessionTx?: unknown, clientTicketId?: string): Promise<void> {
    const s = ticket.state;
    await this.queryIn(sessionTx, (client) => client.query(
      `INSERT INTO after_sales_tickets (id, user_id, conversation_id, type, status, title, description, related_order_id, related_group_id, related_refund_id, created_at, updated_at,client_ticket_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [s.ticketId, s.userId, s.conversationId, s.type, s.status, s.title, s.description, s.relatedOrderId, s.relatedGroupId, s.relatedRefundId, s.createdAt, s.updatedAt,clientTicketId??null]
    ));
  }

  async findByClientKey(userId:string,key:string,tx:unknown):Promise<Ticket|null>{return this.queryIn(tx,async c=>{const {rows}=await c.query<TicketRow>(`SELECT ${COLUMNS} FROM after_sales_tickets WHERE user_id=$1 AND client_ticket_id=$2`,[userId,key]);return rows[0]?ticketOf(rows[0]):null;});}

  async save(ticket: Ticket, sessionTx?: unknown): Promise<void> {
    const s = ticket.state;
    await this.queryIn(sessionTx, (client) => client.query(
      `UPDATE after_sales_tickets SET status = $2, related_refund_id = $3, updated_at = $4, assigned_agent_id = $5 WHERE id = $1`,
      [s.ticketId, s.status, s.relatedRefundId, s.updatedAt, s.assignedAgentId]
    ));
  }

  async findByIdForUpdate(id: string, sessionTx?: unknown): Promise<Ticket | null> {
    return this.queryIn(sessionTx, async (client) => {
      const { rows } = await client.query<TicketRow>(`SELECT ${COLUMNS} FROM after_sales_tickets WHERE id = $1 FOR UPDATE`, [id]);
      return rows[0] ? ticketOf(rows[0]) : null;
    });
  }

  async findById(id: string): Promise<Ticket | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<TicketRow>(`SELECT ${COLUMNS} FROM after_sales_tickets WHERE id = $1`, [id]);
      return rows[0] ? ticketOf(rows[0]) : null;
    });
  }

  async findActionByClientKey(ticketId:string,actorType:string,actorId:string,key:string,tx:unknown):Promise<TicketActionData|null>{return this.queryIn(tx,async c=>{const {rows}=await c.query<ActionRow>('SELECT action,actor_type,actor_id,detail,created_at FROM after_sales_ticket_actions WHERE ticket_id=$1 AND actor_type=$2 AND actor_id=$3 AND client_action_id=$4',[ticketId,actorType,actorId,key]);const r=rows[0];return r?{action:r.action as TicketActionData['action'],actorType:r.actor_type as TicketActionData['actorType'],actorId:r.actor_id,detail:r.detail,createdAt:r.created_at}:null;});}

  async insertAction(ticketId: string, action: TicketActionData, sessionTx?: unknown,clientActionId?:string): Promise<void> {
    await this.queryIn(sessionTx, (client) => client.query(
      `INSERT INTO after_sales_ticket_actions (ticket_id, action, actor_type, actor_id, detail, created_at,client_action_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ticketId, action.action, action.actorType, action.actorId, JSON.stringify(action.detail), action.createdAt,clientActionId??null]
    ));
  }

  async listActions(ticketId: string): Promise<Array<{ action: string; actorType: string; actorId: string | null; detail: Record<string, unknown>; createdAt: Date }>> {
    return this.query(async (client) => {
      const { rows } = await client.query<ActionRow>(
        `SELECT action, actor_type, actor_id, detail, created_at FROM after_sales_ticket_actions WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId]
      );
      return rows.map((row) => ({ action: row.action, actorType: row.actor_type, actorId: row.actor_id, detail: row.detail, createdAt: row.created_at }));
    });
  }

  async listAdmin(query: { status?: string | null; page: number; pageSize: number; agentId?: string }): Promise<{ items: Ticket[]; total: number }> {
    return this.query(async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.agentId) { params.push(query.agentId); conditions.push(`(assigned_agent_id = $${params.length} OR status = 'open')`); }
      if (query.status && ['open', 'processing', 'waiting_feedback','resolved', 'closed'].includes(query.status)) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int AS total FROM after_sales_tickets ${where}`, params);
      const { rows } = await client.query<TicketRow>(
        `SELECT ${COLUMNS} FROM after_sales_tickets ${where} ORDER BY created_at ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize]
      );
      return { items: rows.map(ticketOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }

  async listByUser(userId: string, page: number, pageSize: number): Promise<{ items: Ticket[]; total: number }> {
    return this.query(async (client) => {
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int AS total FROM after_sales_tickets WHERE user_id = $1`, [userId]);
      const { rows } = await client.query<TicketRow>(
        `SELECT ${COLUMNS} FROM after_sales_tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, pageSize, (page - 1) * pageSize]
      );
      return { items: rows.map(ticketOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }
}
