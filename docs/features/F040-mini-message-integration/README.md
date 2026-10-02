# F040 管理端审计/通知页、小程序消息中心与整体联调

- **编号**：F040；所属大任务 [T009](../../tasks/T009-dashboard-notification-audit/README.md)。
- **目标**：管理端 `/access`（权限与审计）、`/notifications`（通知投递）两页 + 小程序消息中心（D023）+ API 客户端函数 + T009 集成测试（A1–A8 端到端）与整体联调。
- **主领域**：两端展示与集成；**负责 Agent**：ZCode（GLM）；**修改目录**：`apps/admin-web/src/features/{access-audit,admin-notifications,reporting-dashboard}`、`apps/admin-web/src/platform/api-client.ts`、`apps/admin-web/src/App.vue`、`apps/mini-program/miniprogram/features/notifications/`、`apps/mini-program/miniprogram/platform/notification-api.ts`、`apps/mini-program/miniprogram/{app.json,features/profile}`、`tests/task-
