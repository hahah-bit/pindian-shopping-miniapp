import { Pool } from 'pg';
import type { DatabaseProbe } from '../../../application/ports/database-probe';

export class PostgresProbe implements DatabaseProbe {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 2000, query_timeout: 2000, statement_timeout: 2000 });
    // 后台连接异常不得使进程因未处理事件退出；就绪查询会报告不可用。
    this.pool.on('error', () => console.error('[database] 空闲连接不可用'));
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
