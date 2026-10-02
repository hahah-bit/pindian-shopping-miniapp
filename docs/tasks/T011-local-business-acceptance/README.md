# T011 两端交互与完整业务验收

- 目标：两端交互与完整业务验收；只完成用户授权的本地/模拟范围。
- 主领域：两端 / 跨上下文流程；协作领域：IdentityAccess、Payments、Ordering、GroupBuying、Fulfillment、AfterSales、Notifications、Audit。
- 负责 Agent：Codex；前置：T010；当前状态：已完成（本地范围）。
- 修改范围：tests/helpers/mini-page、tests/task-suites/t011；tests/task-suites/t011、tests/helpers、scripts/simulation。
- 阻塞项：真实凭据/资金/域名/服务器不在本轮；开发者工具不可用时渲染记录待验。
- 子功能：[F044-mini-page-harness](../../features/F044-mini-page-harness/README.md)、[F045-business-e2e](../../features/F045-business-e2e/README.md)。
- 文件索引：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)，验证时创建 verification。

