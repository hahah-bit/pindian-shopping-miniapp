# F016 plan

TDD：`tests/task-suites/t004/expiry-tasks.test.mjs`（假件 + 冻结时钟）；集成进 t004/integration。Worker 扩展：循环内调用到期任务（异常捕获）。

- P1 领域迁移方法 + 任务用例（先红后绿）。
- P2 pg 查询（SKIP LOCKED）+ Worker 接线。
- P3 集成验证 + 提交。
