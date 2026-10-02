# F037 Plan

引用 [T009 plan](../../tasks/T009-dashboard-notification-audit/plan.md) 步骤 1/3/6；覆盖 F037 spec 全部验收。

1. contracts 类型（OverviewMetrics/ProductMetrics/CsMetrics）；role.ts 权限码（T009 步骤 1 一并）。
2. **TDD**：`tests/task-suites/t009/reporting-metrics.test.mjs` 先行——种子数据（多商品/组/订单/支付/退款三态/全额退款订单/履约单/会话含超时与首响/工单/presence，含跨日界）→ 断言逐指标；空库断言 0/null。先运行确认红（模块不存在）。
3. 实现：`contexts/reporting/domain/metrics.ts`、`application/reporting-queries.ts`（端口 `ReportingReadModel` + 用例）、`adapters/outbound/postgres/reporting-read-model.ts`（SQL 投影）、`adapters/inbound/admin/reporting.controller.ts`（`@RequirePermissions`）；foundation.module 装配；context-registry partial。
4. 前端：`features/reporting-dashboard/ReportingDashboardView.vue` + api-client 函数；App.vue 路由替换占位。
5. 验证：专项红→绿记录；有数据页面浏览器交互（隔离环境）在 T009 收尾统一执行。
