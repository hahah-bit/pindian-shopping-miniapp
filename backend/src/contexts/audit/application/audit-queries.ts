import { ApplicationError } from '../../../shared/kernel';

export interface AuditLogItem {
  id: string;
  adminId: string | null;
  adminDisplayName: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  detail: Record<string, unknown>;
  requestId: string | null;
  createdAt: string;
}

export interface AuditLogQuery {
  adminId?: string | null;
  action?: string | null;
  resourceType?: string | null;
  from?: string | null;
  to?: string | null;
  page: number;
  pageSize: number;
}

/** 只读查询端口：由出站适配器以 SQL 实现（F039）。 */
export interface AuditLogQueryPort {
  listLogs(query: { adminId: string | null; actionLike: string | null; resourceTypeLike: string | null; fromUtc: Date | null; toUtc: Date | null; page: number; pageSize: number }): Promise<{ items: AuditLogItem[]; total: number }>;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const SENSITIVE_KEYS = new Set(['phone', 'telephone', 'mobile']);

function maskPhoneText(text: string): string {
  return text.replace(PHONE_PATTERN, (m) => `${m.slice(0, 3)}****${m.slice(-4)}`);
}

/** 响应层脱敏：字符串值按大陆手机号模式掩码（138****1230）；不修改库内数据。 */
export function maskSensitiveDetail(value: unknown, key?: string): unknown {
  if (typeof value === 'string') {
    void key;
    return maskPhoneText(value);
  }
  if (Array.isArray(value)) return value.map((item) => maskSensitiveDetail(item));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = maskSensitiveDetail(v, k);
    }
    return result;
  }
  return value;
}

function resolveDayBoundary(text: string | null | undefined, edge: 'start' | 'end'): Date | null {
  if (text === null || text === undefined || text === '') return null;
  if (!DATE_PATTERN.test(text)) throw new ApplicationError('VALIDATION_FAILED', '日期必须是 YYYY-MM-DD');
  const parts = text.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) throw new ApplicationError('VALIDATION_FAILED', '日期必须是 YYYY-MM-DD');
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new ApplicationError('VALIDATION_FAILED', '日期不是有效的日历日');
  }
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 8 * 3600_000);
  return edge === 'start' ? startUtc : new Date(startUtc.getTime() + 86_400_000);
}

/** 操作日志查询用例（T009/F039）：只读、分页、筛选、响应层脱敏。 */
export class AuditLogQueries {
  private readonly queryPort: AuditLogQueryPort;

  constructor(deps: { queryPort: AuditLogQueryPort }) {
    this.queryPort = deps.queryPort;
  }

  async listLogs(query: AuditLogQuery): Promise<{ items: AuditLogItem[]; total: number }> {
    const fromUtc = resolveDayBoundary(query.from, 'start');
    const toUtc = resolveDayBoundary(query.to, 'end');
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? 10)));
    const result = await this.queryPort.listLogs({
      adminId: query.adminId ?? null,
      actionLike: query.action ?? null,
      resourceTypeLike: query.resourceType ?? null,
      fromUtc,
      toUtc,
      page,
      pageSize
    });
    return {
      total: result.total,
      items: result.items.map((item) => ({ ...item, detail: maskSensitiveDetail(item.detail) as Record<string, unknown> }))
    };
  }
}
