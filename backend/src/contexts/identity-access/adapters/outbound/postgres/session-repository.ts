import type { PoolClient } from 'pg';
import { AdminSession, type AdminSessionState } from '../../../domain/admin-session';
import type { SessionRepository } from '../../../application/ports';

interface SessionRow {
  id: string;
  admin_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

function toDomain(row: SessionRow): AdminSession {
  return AdminSession.rehydrate({
    sessionId: row.id,
    adminId: row.admin_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? null,
    createdAt: row.created_at
  });
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly pool: { connect(): Promise<PoolClient> }) {}

  private async query<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { return await fn(client); } finally { client.release(); }
  }

  async save(session: AdminSession): Promise<void> {
    const s = session.state;
    await this.query((client) => client.query(
      `INSERT INTO admin_sessions (id, admin_id, token_hash, expires_at, revoked_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at`,
      [s.sessionId, s.adminId, s.tokenHash, s.expiresAt, s.revokedAt, s.createdAt]
    ));
  }

  async findById(sessionId: string): Promise<AdminSession | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<SessionRow>('SELECT * FROM admin_sessions WHERE id = $1', [sessionId]);
      return rows[0] ? toDomain(rows[0]) : null;
    });
  }

  async findByTokenHash(tokenHash: string): Promise<AdminSession | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<SessionRow>('SELECT * FROM admin_sessions WHERE token_hash = $1', [tokenHash]);
      return rows[0] ? toDomain(rows[0]) : null;
    });
  }

  async revoke(sessionId: string, at: Date): Promise<void> {
    await this.query((client) => client.query(
      'UPDATE admin_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [sessionId, at]
    ));
  }

  async revokeAllForAdmin(adminId: string, at: Date): Promise<void> {
    await this.query((client) => client.query(
      'UPDATE admin_sessions SET revoked_at = $2 WHERE admin_id = $1 AND revoked_at IS NULL', [adminId, at]
    ));
  }

  async deleteExpired(now: Date): Promise<number> {
    return this.query(async (client) => {
      const result = await client.query('DELETE FROM admin_sessions WHERE expires_at <= $1', [now]);
      return result.rowCount ?? 0;
    });
  }
}
