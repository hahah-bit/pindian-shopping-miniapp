import type { PoolClient } from 'pg';
import type { OperationLog } from '../../../domain/operation-log';
import type { OperationLogRepository } from '../../../application/ports';

export class PostgresOperationLogRepository implements OperationLogRepository {
  constructor(private readonly pool: { connect(): Promise<PoolClient> }) {}

  async insert(log: OperationLog, sessionTx?: unknown): Promise<void> {
    // sessionTx：与业务事务同连接（T008 R04 模式——审计失败整体回滚）
    if (sessionTx && typeof (sessionTx as { query?: unknown }).query === 'function') {
      await (sessionTx as { query: (...args: unknown[]) => Promise<unknown> }).query(
        `INSERT INTO admin_operation_logs (admin_id, action, resource_type, resource_id, detail, request_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [log.state.adminId, log.state.action, log.state.resourceType, log.state.resourceId, JSON.stringify(log.state.detail), log.state.requestId, log.state.createdAt]
      );
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query(
        `INSERT INTO admin_operation_logs (admin_id, action, resource_type, resource_id, detail, request_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [log.state.adminId, log.state.action, log.state.resourceType, log.state.resourceId, JSON.stringify(log.state.detail), log.state.requestId, log.state.createdAt]
      );
    } finally { client.release(); }
  }
}
