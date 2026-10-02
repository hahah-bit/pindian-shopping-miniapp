# T012 部署与运行维护准备

- 目标：部署与运行维护准备；只完成用户授权的本地/模拟范围。
- 主领域：Bootstrap / 运维；协作领域：IdentityAccess、Payments、Ordering、GroupBuying、Fulfillment、AfterSales、Notifications、Audit。
- 负责 Agent：Codex；前置：T011；当前状态：已完成（本地范围）。
- 修改范围：infra/release、compose.production.yaml、scripts/release；scripts/release、tests/task-suites/t012；scripts/release、docs/tasks/T012-release-readiness、tests/task-suites/t012。
- 阻塞项：真实凭据/资金/域名/服务器不在本轮；开发者工具不可用时渲染记录待验。
- 子功能：[F046-production-deployment](../../features/F046-production-deployment/README.md)、[F047-backup-health](../../features/F047-backup-health/README.md)、[F048-release-rollback](../../features/F048-release-rollback/README.md)。
- 文件索引：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)，验证时创建 verification。

