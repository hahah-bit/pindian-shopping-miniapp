import 'reflect-metadata';
import { Pool } from 'pg';
import { SystemClock } from '../shared/kernel';
import { CreateOrUpdateInitialAdmin } from '../contexts/identity-access/application';
import { PostgresAdminRepository } from '../contexts/identity-access/adapters/outbound/postgres/admin-repository';
import { PostgresSessionRepository } from '../contexts/identity-access/adapters/outbound/postgres/session-repository';
import { ScryptPasswordHasher } from '../contexts/identity-access/adapters/outbound/crypto/scrypt-password-hasher';

/**
 * 初始管理员创建/更新（幂等）。凭据仅经环境变量传入：
 * ADMIN_INITIAL_USERNAME / ADMIN_INITIAL_PASSWORD；输出不包含密码。
 */
async function main(): Promise<void> {
  const username = process.env.ADMIN_INITIAL_USERNAME;
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('必须设置 DATABASE_URL');
  if (!username || !password) {
    throw new Error('必须设置 ADMIN_INITIAL_USERNAME 和 ADMIN_INITIAL_PASSWORD（凭据不进入源码与镜像）');
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const useCase = new CreateOrUpdateInitialAdmin({
      admins: new PostgresAdminRepository(pool),
      sessions: new PostgresSessionRepository(pool),
      hasher: new ScryptPasswordHasher(),
      clock: new SystemClock()
    });
    const result = await useCase.execute({ username, password });
    console.log(`[admin-init] ${result.created ? '已创建初始管理员' : '已更新既有管理员并撤销旧会话'}：${username}（id=${result.adminId}）`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '初始管理员创建失败');
  process.exitCode = 1;
});
