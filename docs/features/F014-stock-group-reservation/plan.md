# F014 plan

TDD：`tests/task-suites/t004/stock-reservation.test.mjs`（单测假件 + 集成真实 PG 并发）。实现 Inventory 公开能力（application/ports + pg 适配器扩展）。

- P1 端口与用例（假件测试先红后绿）。
- P2 pg 适配器（条件更新 + movement 幂等键）。
- P3 集成并发验证（进 t004/integration）。
- P4 提交。
