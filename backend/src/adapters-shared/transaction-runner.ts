import type { Pool } from 'pg';
import type { TransactionRunner } from '../shared/kernel';

/** pg 事务执行器：应用声明边界，适配器实现 BEGIN/COMMIT/ROLLBACK。 */
export class PostgresTransactionRunner implements TransactionRunner {
  constructor(private readonly pool: Pool) {}

  async run<T>(work: (session: unknown) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
