# F015 plan

TDD：`tests/task-suites/t004/quote-order.test.mjs`（定价矩阵 + 编排假件先红后绿）；真实 PG 集成进 t004/integration（并发竞争/回滚/幂等）。

- P1 QuotePricing 纯函数 + 测试矩阵。
- P2 Group/ShareReservation/Order 领域实体。
- P3 仓储接口 + pg 适配器（FOR UPDATE、唯一约束）。
- P4 PlaceOrderWorkflow + CancelUnpaidOrder。
- P5 HTTP 控制器（mini orders）。
- P6 集成验证 + 提交。
