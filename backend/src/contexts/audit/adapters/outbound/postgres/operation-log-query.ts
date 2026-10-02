import type { Pool } from 'pg';
import type { AuditLogItem, AuditLogQueryPort } from '../../../application/audit-queries';

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** 操作日志只读查询（F039）：前缀筛选、上海日界时间范围、稳定排序分页。 */
export class PostgresOperationLogQuery implements AuditLogQueryPort {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listLogs(query: { adminId: string | null; actionLike: string | null; resourceTypeLike: string | null; fromUtc: Date | null; toUtc: Date | null; page: number; pageSize: number }): Promise<{ items: AuditLogItem[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (fragment: string, value: unknown): void => {
      params.push(value);
      conditions.push(fragment.replace('$?', `$${params.length}`));
    };
    if (query.adminId) add(`l.admin_id = $?`, query.adminId);
    if (query.actionLike) add(`l.action LIKE $?`, `${escapeLike(query.actionLike)}%`);
    if (query.resourceTypeLike) add(`l.resource_type LIKE $?`, `${escapeLike(query.resourceTypeLike)}%`);
    if (query.fromUtc) add(`l.created_at >= $?`, query.fromUtc);
    if (query.toUtc) add(`l.created_at < $?`, query.toUtc);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = await this.pool.query(`SELECT COUNT(*)::int AS c FROM admin_operation_logs l ${where}`, params);
    const rows = await this.pool.query(
      `SELECT l.id, l.admin_id, a.display_name, l.action, l.resource_type, l.resource_id, l.detail, l.request_id, l.created_at
         FROM admin_operation_logs l LEFT JOIN admins a ON a.id = l.admin_id
         ${where}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, (query.page - 1) * query.pageSize]
    );
    return {
      total: Number((total.rows[0] as { c: number } | undefined)?.c ?? 0),
      items: rows.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: String(row.id),
          adminId: row.admin_id === null ? null : String(row.admin_id),
          adminDisplayName: row.display_name === null || row.display_name === undefined ? null : String(row.display_name),
          action: String(row.action),
          resourceType: String(row.resource_type),
          resourceId: row.resource_id === null || row.resource_id === undefined ? null : String(row.resource_id),
          detail: (row.detail ?? {}) as Record<string, unknown>,
          requestId: row.request_id === null || row.request_id === undefined ? null : String(row.request_id),
          createdAt: new Date(row.created_at as string).toISOString()
        };
      })
    };
  }
}
