import { withExecutor, type PgExecutor } from '../../../../../adapters-shared/pg-client';

export interface TransactionalAuditEntry {
  adminId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  detail?: Record<string, unknown>;
}

/**
 * 履约操作审计适配器（R04）：与业务事务同连接写入 admin_operation_logs。
 * - sessionTx 缺省时走独立连接（仅导出等只读旁路使用，失败不抛出）；
 * - 事务内写入失败必须向上抛出（整体回滚）——保证不漏审计、不出现"业务已提交却报错"。
 */
export class TransactionalFulfillmentAudit {
  constructor(private readonly pool: PgExecutor) {}

  async execute(entry: TransactionalAuditEntry, sessionTx?: unknown): Promise<void> {
    const write = async (client: PgExecutor) => {
      await client.query(
        `INSERT INTO admin_operation_logs (admin_id, action, resource_type, resource_id, detail, request_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entry.adminId, entry.action, entry.resourceType, entry.resourceId, JSON.stringify(entry.detail ?? {}), entry.requestId]
      );
    };
    if (sessionTx) {
      await withExecutor(sessionTx as PgExecutor, async (client) => write(client));
      return;
    }
    // 事务外旁路审计（导出明文）：失败必须向上抛——调用方阻断无留痕导出（2026-10-02 复验 P2）
    await withExecutor(this.pool, async (client) => write(client));
  }
}
