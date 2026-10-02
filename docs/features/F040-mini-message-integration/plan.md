# F040 Plan

引用 [T009 plan](../../tasks/T009-dashboard-notification-audit/plan.md) 步骤 6/7。

1. api-client.ts 增看板/审计/通知函数；App.vue 路由与导航（/notifications 新导航项）。
2. 管理端三页（样式复用 data-table/toolbar/badge/pager/summary-grid；**不引入图表库**，看板用卡片网格）。
3. 小程序：app.json 注册；platform/notification-api.ts（复用 http 会话）；features/notifications 四件套；profile 入口+未读数。
4. **测试策略（AGENTS §2.2 判断：非 TDD）**：页面为布局/展示，实现后以构建 + 有数据隔离环境浏览器交互验证；后端契约由 F037–F039 TDD 与本 F 集成测试覆盖。
5. 集成测试在后端就绪后编写；页面完成后专项→全量→Docker。
