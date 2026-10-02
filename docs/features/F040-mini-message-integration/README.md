# F040 管理端审计/通知页、小程序消息中心与整体联调

- 编号：F040；所属大任务[T009](../../tasks/T009-dashboard-notification-audit/README.md)，[整体spec](../../tasks/T009-dashboard-notification-audit/spec.md)、[整体plan](../../tasks/T009-dashboard-notification-audit/plan.md)。
- 目标：管理端审计/权限/通知和小程序消息中心，接入真实API。
- 主领域：两端展示；协作：Notifications、Audit、IdentityAccess、Reporting。
- 负责Agent：原实现ZCode，本轮独立复验/回归整改Codex。
- 修改范围：apps/admin-web/src/features/access-audit、admin-notifications、apps/mini-program/miniprogram/features/notifications、platform/notification-api.ts，tests/task-suites/t009与t011。
- 前置：F037–F039；当前状态：本地实现与本轮相关验收完成；阻塞项：真实微信渲染/真机待环境；T009独立浏览器通知重试确认后刷新已补验。
- 文件索引：ddd.md、spec.md、plan.md、verification.md、local-integration-fix.md；最新独立记录[T009](../../tasks/T009-dashboard-notification-audit/independent-verification.md)、[T011](../../tasks/T011-local-business-acceptance/verification.md)。

原README存在截断，2026-10-02独立收尾补齐，不改原业务规则。
