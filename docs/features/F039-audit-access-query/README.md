# F039 操作日志查询、权限矩阵与权限码扩展

- **编号**：F039；所属大任务 [T009](../../tasks/T009-dashboard-notification-audit/README.md)。
- **目标**：`admin_operation_logs` 只读查询（分页/多条件筛选/时间范围/脱敏）、角色权限矩阵端点、4 个新权限码（D025）。写入路径不变（复用既有 RecordOperation 与 FULFILLMENT_AUDIT）；资金审核权限边界不变。
- **主领域**：Audit / IdentityAccess；**负责 Agent**：ZCode（GLM）；**修改目录**：`backend/src/contexts/audit/`、`backend/src/contexts/identity-access/domain/role.ts`、`backend/src/bootstrap/foundation.module.ts`、`contracts/src`、`tests/task-suites/t009/`。
- **前置**：T007/T008 已有审计写入；**当前状态**：已完成（本地验收，见 verification.md）；**阻塞项**：无。
