# F007 后台商品与库存管理

- 功能编号：F007
- 目标：商品创建/编辑/查看/上下架、允许份额配置、参考价与份额数量展示、整件库存设置与调整留痕。
- 主领域：Catalog（Product 聚合）；协作领域：Inventory（Stock/StockMovement）、IdentityAccess（权限）、Audit（日志）。
- 负责 Agent：当前主 Agent。
- 所属大任务：[T002](../../tasks/T002-catalog-admin-media/README.md)；整体设计见 [T002 ddd](../../tasks/T002-catalog-admin-media/ddd.md)、[T002 spec](../../tasks/T002-catalog-admin-media/spec.md)。
- 修改目录：`backend/src/contexts/catalog`（product 部分）、`backend/src/contexts/inventory`、`backend/src/workflows`、`backend/migrations/0004*、0005*`、`contracts`、`apps/admin-web`、`tests/task-suites/t002`。
- 前置功能：[F005](../F005-admin-auth/README.md)、[F006](../F006-media-assets/README.md)。
- 当前状态：已完成（TDD + 集成 + 浏览器实操；见 verification.md）。
- 阻塞项：无（支付尾差等见 T002 spec 待决策表，不影响本功能）。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-09-30：完成实现与验收（含 wholeQuantity 尾零修复与回归）。
