import { ApplicationError } from '../../../shared/kernel';

export interface OperationLogState {
  adminId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  detail: Record<string, unknown>;
  requestId: string | null;
  createdAt: Date;
}

/** 后台操作日志：追加型事实记录，不参与业务决策。 */
export class OperationLog {
  readonly state: OperationLogState;

  constructor(state: OperationLogState) {
    const action = state.action.trim();
    const resourceType = state.resourceType.trim();
    if (!action || action.length > 64) throw new ApplicationError('VALIDATION_FAILED', '操作动作不能为空且不超过 64 字符');
    if (!resourceType || resourceType.length > 32) throw new ApplicationError('VALIDATION_FAILED', '资源类型不能为空且不超过 32 字符');
    this.state = { ...state, action, resourceType };
  }
}
