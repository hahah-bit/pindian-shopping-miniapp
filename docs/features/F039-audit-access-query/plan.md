# F039 Plan

引用 [T009 plan](../../tasks/T009-dashboard-notification-audit/plan.md) 步骤 1/5；覆盖 F039 spec 全部验收。

1. **TDD**：`tests/task-suites/t009/audit-query.test.mjs` 先行——真实 PG 种子日志（detail 含手机号对象/裸字符串、跨日界）→ 断言分页/筛选/脱敏/矩阵；先红。
2. 实现：audit application/audit-queries.ts（端口+用例+脱敏纯函数）→ adapters/outbound/postgres/operation-log-query.ts → adapters/inbound/admin/audit.controller.ts（logs、role-matrix）→ foundation.module 装配；role.ts + contracts 权限码。
3. 验证：专项红→绿；T002/T008 回归在全量阶段确认。
