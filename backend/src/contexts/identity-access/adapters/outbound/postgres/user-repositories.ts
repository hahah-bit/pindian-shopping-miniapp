import type { PoolClient } from 'pg';
import { User, type UserState } from '../../../domain/user/user';
import { WechatIdentity } from '../../../domain/user/wechat-identity';
import { UserSession } from '../../../domain/user/user-session';
import { Address, type AddressState } from '../../../domain/user/address';
import type { UserRepository, WechatIdentityRepository, UserSessionRepository } from '../../../application/user/user-ports';
import type { AddressRepository } from '../../../application/user/address-ports';
import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

// ---------- User ----------

interface UserRow {
  id: string;
  nickname: string;
  phone: string | null;
  phone_country_code: string;
  phone_verified_at: Date | null;
  phone_source: string | null;
  status: UserState['status'];
  created_at: Date;
  last_login_at: Date | null;
}

function userOf(row: UserRow): User {
  return User.rehydrate({
    userId: row.id,
    nickname: row.nickname,
    phone: row.phone,
    phoneCountryCode: row.phone_country_code,
    phoneVerifiedAt: row.phone_verified_at ?? null,
    phoneSource: (row.phone_source as UserState['phoneSource']) ?? null,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null
  });
}

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  async findById(userId: string): Promise<User | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
      return rows[0] ? userOf(rows[0]) : null;
    });
  }

  async findByIdIfActive(userId: string): Promise<User | null> {
    const user = await this.findById(userId);
    return user && user.isActive ? user : null;
  }

  async save(user: User, session?: unknown): Promise<void> {
    const s = user.state;
    await withExecutor((session as PgExecutor) ?? this.pool, (client) => client.query(
      `INSERT INTO users (id, nickname, phone, phone_country_code, phone_verified_at, phone_source, status, created_at, last_login_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         nickname = EXCLUDED.nickname,
         phone = EXCLUDED.phone,
         phone_country_code = EXCLUDED.phone_country_code,
         phone_verified_at = EXCLUDED.phone_verified_at,
         phone_source = EXCLUDED.phone_source,
         status = EXCLUDED.status,
         last_login_at = EXCLUDED.last_login_at`,
      [s.userId, s.nickname, s.phone, s.phoneCountryCode, s.phoneVerifiedAt, s.phoneSource, s.status, s.createdAt, s.lastLoginAt]
    ));
  }

  async updateStatus(userId: string, status: 'active' | 'disabled', at: Date): Promise<boolean> {
    return this.query(async (client) => {
      const result = await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);
      void at;
      return (result.rowCount ?? 0) > 0;
    });
  }

  async lockById(userId: string, sessionTx: unknown): Promise<void> {
    await withExecutor(sessionTx as PgExecutor, (client) => client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]));
  }

  async listUsers(query: { keyword?: string | null; status?: string | null; page: number; pageSize: number }): Promise<{ items: User[]; total: number }> {
    return this.query(async (client) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.keyword) { params.push(`%${query.keyword}%`); conditions.push(`nickname ILIKE $${params.length}`); }
      if (query.status) { params.push(query.status); conditions.push(`status = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows: countRows } = await client.query<{ total: string }>(`SELECT COUNT(*)::int4 AS total FROM users ${where}`, params);
      const { rows } = await client.query<UserRow>(
        `SELECT * FROM users ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, query.pageSize, (query.page - 1) * query.pageSize]
      );
      return { items: rows.map(userOf), total: Number(countRows[0]?.total ?? 0) };
    });
  }
}

// ---------- WechatIdentity ----------

export class PostgresWechatIdentityRepository implements WechatIdentityRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  async findByOpenid(openid: string): Promise<WechatIdentity | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<{ id: string; openid: string; unionid: string | null; user_id: string; bound_at: Date }>(
        'SELECT * FROM user_wechat_identities WHERE openid = $1', [openid]
      );
      const row = rows[0];
      return row ? WechatIdentity.rehydrate({ identityId: row.id, openid: row.openid, unionid: row.unionid, userId: row.user_id, boundAt: row.bound_at }) : null;
    });
  }

  async findByUserId(userId: string): Promise<WechatIdentity | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<{ id: string; openid: string; unionid: string | null; user_id: string; bound_at: Date }>(
        'SELECT * FROM user_wechat_identities WHERE user_id = $1 LIMIT 1', [userId]
      );
      const row = rows[0];
      return row ? WechatIdentity.rehydrate({ identityId: row.id, openid: row.openid, unionid: row.unionid, userId: row.user_id, boundAt: row.bound_at }) : null;
    });
  }

  async insert(identity: WechatIdentity, session?: unknown): Promise<void> {
    const s = identity.state;
    await withExecutor((session as PgExecutor) ?? this.pool, (client) => client.query(
      'INSERT INTO user_wechat_identities (id, openid, unionid, user_id, bound_at) VALUES ($1,$2,$3,$4,$5)',
      [s.identityId, s.openid, s.unionid, s.userId, s.boundAt]
    ));
  }
}

// ---------- UserSession ----------

interface SessionRow { id: string; user_id: string; token_hash: string; expires_at: Date; revoked_at: Date | null; created_at: Date }

function sessionOf(row: SessionRow): UserSession {
  return UserSession.rehydrate({ sessionId: row.id, userId: row.user_id, tokenHash: row.token_hash, expiresAt: row.expires_at, revokedAt: row.revoked_at ?? null, createdAt: row.created_at });
}

export class PostgresUserSessionRepository implements UserSessionRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  async save(session: UserSession, sessionTx?: unknown): Promise<void> {
    const s = session.state;
    await withExecutor((sessionTx as PgExecutor) ?? this.pool, (client) => client.query(
      `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at, revoked_at = EXCLUDED.revoked_at`,
      [s.sessionId, s.userId, s.tokenHash, s.expiresAt, s.revokedAt, s.createdAt]
    ));
  }

  async findByTokenHash(tokenHash: string): Promise<UserSession | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<SessionRow>('SELECT * FROM user_sessions WHERE token_hash = $1', [tokenHash]);
      return rows[0] ? sessionOf(rows[0]) : null;
    });
  }

  async findBySessionId(sessionId: string): Promise<UserSession | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<SessionRow>('SELECT * FROM user_sessions WHERE id = $1', [sessionId]);
      return rows[0] ? sessionOf(rows[0]) : null;
    });
  }

  async revoke(sessionId: string, at: Date): Promise<void> {
    await this.query((client) => client.query('UPDATE user_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [sessionId, at]));
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.query((client) => client.query('UPDATE user_sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, at]));
  }

  async deleteExpired(now: Date): Promise<number> {
    return this.query(async (client) => {
      const result = await client.query('DELETE FROM user_sessions WHERE expires_at <= $1', [now]);
      return result.rowCount ?? 0;
    });
  }
}

// ---------- Address ----------

interface AddressRow {
  id: string;
  user_id: string;
  receiver_name: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

function addressOf(row: AddressRow): Address {
  return Address.rehydrate({
    addressId: row.id,
    userId: row.user_id,
    receiverName: row.receiver_name,
    phone: row.phone,
    province: row.province,
    city: row.city,
    district: row.district,
    detail: row.detail,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export class PostgresAddressRepository implements AddressRepository {
  constructor(private readonly pool: PgExecutor) {}

  private async query<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    return withExecutor(this.pool, work);
  }

  async insert(address: Address, session?: unknown): Promise<void> {
    const s = address.state;
    await withExecutor((session as PgExecutor) ?? this.pool, (client) => client.query(
      `INSERT INTO user_addresses (id, user_id, receiver_name, phone, province, city, district, detail, is_default, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [s.addressId, s.userId, s.receiverName, s.phone, s.province, s.city, s.district, s.detail, s.isDefault, s.createdAt, s.updatedAt]
    ));
  }

  async findById(addressId: string, userId: string): Promise<Address | null> {
    return this.query(async (client) => {
      const { rows } = await client.query<AddressRow>('SELECT * FROM user_addresses WHERE id = $1 AND user_id = $2', [addressId, userId]);
      return rows[0] ? addressOf(rows[0]) : null;
    });
  }

  async findByIdForUpdate(addressId: string, userId: string, sessionTx: unknown): Promise<Address | null> {
    return withExecutor(sessionTx as PgExecutor, async (client) => {
      const { rows } = await client.query<AddressRow>('SELECT * FROM user_addresses WHERE id = $1 AND user_id = $2 FOR UPDATE', [addressId, userId]);
      return rows[0] ? addressOf(rows[0]) : null;
    });
  }

  async listByUser(userId: string): Promise<Address[]> {
    return this.query(async (client) => {
      const { rows } = await client.query<AddressRow>(
        'SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, updated_at DESC, id DESC', [userId]
      );
      return rows.map(addressOf);
    });
  }

  async countByUser(userId: string): Promise<number> {
    return this.query(async (client) => {
      const { rows } = await client.query<{ count: string }>('SELECT COUNT(*)::int4 AS count FROM user_addresses WHERE user_id = $1', [userId]);
      return Number(rows[0]?.count ?? 0);
    });
  }

  async update(address: Address, session?: unknown): Promise<void> {
    const s = address.state;
    await withExecutor((session as PgExecutor) ?? this.pool, (client) => client.query(
      `UPDATE user_addresses SET receiver_name = $2, phone = $3, province = $4, city = $5, district = $6, detail = $7, is_default = $8, updated_at = $9
       WHERE id = $1 AND user_id = $10`,
      [s.addressId, s.receiverName, s.phone, s.province, s.city, s.district, s.detail, s.isDefault, s.updatedAt, s.userId]
    ));
  }

  async delete(addressId: string, userId: string): Promise<boolean> {
    return this.query(async (client) => {
      const result = await client.query('DELETE FROM user_addresses WHERE id = $1 AND user_id = $2', [addressId, userId]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  async clearDefaultExcept(userId: string, keepId: string, sessionTx?: unknown): Promise<void> {
    await withExecutor((sessionTx as PgExecutor) ?? this.pool, (client) => client.query(
      'UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND id <> $2 AND is_default = true', [userId, keepId]
    ));
  }
}
