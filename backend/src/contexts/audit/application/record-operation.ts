import type { Clock } from '../../../shared/kernel';
import { OperationLog } from '../domain/operation-log';
import type { OperationLogRepository } from './ports';

export interface RecordOperationInput {
  adminId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  detail?: Record<string, unknown>;
  requestId?: string;
}

/**
 * 记录后台操作日志。日志失败不阻断业务主流程：内部捕获并输出服务端告警。
 */
export class RecordOperation {
  constructor(private readonly deps: { repository: OperationLogRepository; clock: Clock }) {}

  async execute(input: RecordOperationInput): Promise<void> {
    try {
      const log = new OperationLog({
        adminId: input.adminId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        detail: input.detail ?? {},
        requestId: input.requestId ?? null,
        createdAt: this.deps.clock.now()
      });
      await this.deps.repository.insert(log);
    } catch (error) {
      console.error('[audit] 操作日志写入失败', error instanceof Error ? error.message : error);
    }
  }
}
