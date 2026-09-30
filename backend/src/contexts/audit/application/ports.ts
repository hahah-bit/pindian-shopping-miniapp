import type { OperationLog } from '../domain/operation-log';

export interface OperationLogRepository {
  insert(log: OperationLog): Promise<void>;
}
