# T010 本地微信模拟联调

- 目标：本地微信模拟联调；只完成用户授权的本地/模拟范围。
- 主领域：IdentityAccess / Payments；协作领域：IdentityAccess、Payments、Ordering、GroupBuying、Fulfillment、AfterSales、Notifications、Audit。
- 负责 Agent：Codex；前置：T009；当前状态：已完成（本地范围）。
- 修改范围：backend/src/bootstrap、compose.yaml、infra/simulation、scripts/simulation；infra/simulation、scripts/simulation、tests/task-suites/t010；infra/simulation、scripts/simulation、tests/task-suites/t010。
- 阻塞项：真实凭据/资金/域名/服务器不在本轮；开发者工具不可用时渲染记录待验。
- 子功能：[F041-environment-isolation](../../features/F041-environment-isolation/README.md)、[F042-wechat-identity-simulator](../../features/F042-wechat-identity-simulator/README.md)、[F043-wechat-payment-simulator](../../features/F043-wechat-payment-simulator/README.md)。
- 文件索引：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)，验证时创建 verification。
