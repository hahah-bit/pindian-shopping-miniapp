# F037 运营看板统计查询与管理端页面

- **编号**：F037；所属大任务 [T009](../../tasks/T009-dashboard-notification-audit/README.md)（整体 spec/plan/ddd 见该目录）。
- **目标**：`reporting` 上下文从空壳落地为只读统计投影：总览+商品数据（`reporting:view`）、客服数据（`reporting:view_cs`）两个端点与管理端 `/reporting` 页面。指标口径 D024（spec §2）。
- **主领域**：Reporting；**协作**：IdentityAccess（权限码）、各业务上下文（只读事实表）。
- **负责 Agent**：ZCode（GLM）；**修改目录**：`backend/src/contexts/reporting/`、`backend/src/bootstrap/{foundation.module.ts,context-registry.ts}`、`contracts/src`、`apps/admin-web/src/features/reporting-dashboard/`、`tests/task-suites/t009/`。
- **前置**：T004/T006/T007/T008 事实表；**当前状态**：已完成（本地验收，见 verification.md）；**阻塞项**：无。
