# F038 Plan

引用 [T009 plan](../../tasks/T009-dashboard-notification-audit/plan.md) 步骤 2/4；覆盖 F038 spec 全部验收。

1. 迁移 0027（表/约束/索引，T009 plan §4）。
2. **TDD**：`tests/task-suites/t009/notification-pipeline.test.mjs` 先行——领域单测（fake 仓储：create/markRead/recordAttempt/reset）+ 真实 PG（幂等键并发、扫描筛选、双实例并发、退避重试、超时阈值）。先红后绿。
3. 实现：domain/notification.ts；application/{record-notification,delivery-driver,retry-delivery,event-catchup,timeout-reminder,ports}.ts；adapters/outbound/postgres/{notification-repository,scan-ports}.ts + outbound/channel/unconfigured-channel.ts；adapters/inbound/{admin,mini} 控制器；config + foundation.module + worker.ts 三任务装配。
4. 验证：专项红→绿；Docker 冒烟观察 Worker 新任务日志与 skipped 留痕（T009 收尾统一）。
