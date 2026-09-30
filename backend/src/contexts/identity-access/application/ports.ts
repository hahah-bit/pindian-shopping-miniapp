import type { Admin } from '../domain/admin';
import type { AdminSession } from '../domain/admin-session';

export interface AdminRepository {
  findById(adminId: string): Promise<Admin | null>;
  findByUsername(username: string): Promise<Admin | null>;
  save(admin: Admin): Promise<void>;
}

export interface SessionRepository {
  save(session: AdminSession): Promise<void>;
  findById(sessionId: string): Promise<AdminSession | null>;
  findByTokenHash(tokenHash: string): Promise<AdminSession | null>;
  revoke(sessionId: string, at: Date): Promise<void>;
  revokeAllForAdmin(adminId: string, at: Date): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

/** token 生成与哈希；原文只在登录响应出现一次。 */
export interface AdminTokenService {
  generate(): string;
  hash(token: string): string;
}
