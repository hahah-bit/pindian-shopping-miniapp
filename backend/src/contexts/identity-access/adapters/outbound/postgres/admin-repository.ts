import type { PoolClient } from 'pg';
import { Admin, type AdminState } from '../../../domain/admin';
import type { AdminRepository } from '../../../application/ports';

interface AdminRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: AdminState['role'];
  status: AdminState['status'];
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: AdminRow): Admin {
  return Admin.rehydrate({
    adminId: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export class PostgresAdminRepository implements AdminRepository {
  constructor(private readonly pool: { connect(): Promise<PoolClient> }) {}

  async findById(adminId: string): Promise<Admin | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<AdminRow>('SELECT * FROM admins WHERE id = $1', [adminId]);
      return rows[0] ? toDomain(rows[0]) : null;
    } finally { client.release(); }
  }

  async findByUsername(username: string): Promise<Admin | null> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<AdminRow>('SELECT * FROM admins WHERE username = $1', [username.toLowerCase()]);
      return rows[0] ? toDomain(rows[0]) : null;
    } finally { client.release(); }
  }

  async save(admin: Admin): Promise<void> {
    const s = admin.state;
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO admins (id, username, display_name, password_hash, role, status, last_login_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           status = EXCLUDED.status,
           last_login_at = EXCLUDED.last_login_at,
           updated_at = EXCLUDED.updated_at`,
        [s.adminId, s.username, s.displayName, s.passwordHash, s.role, s.status, s.lastLoginAt, s.createdAt, s.updatedAt]
      );
    } finally { client.release(); }
  }
}
