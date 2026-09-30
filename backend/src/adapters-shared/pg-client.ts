import type { Pool, PoolClient, QueryResult } from 'pg';

/** 仓储可用的执行器：连接池或事务客户端。 */
export type PgExecutor = Pool | PoolClient;

export function isPoolClient(executor: unknown): executor is PoolClient {
  return typeof executor === 'object' && executor !== null && 'release' in executor && typeof (executor as PoolClient).release === 'function';
}

/** 在给定会话（事务客户端）或自有连接上执行查询。 */
export async function withExecutor<T>(executor: PgExecutor, work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (isPoolClient(executor)) return work(executor);
  const client = await executor.connect();
  try { return await work(client); } finally { client.release(); }
}

export type Row = Record<string, unknown>;
export type { QueryResult };
