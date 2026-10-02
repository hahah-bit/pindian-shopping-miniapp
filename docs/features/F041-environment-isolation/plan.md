# 环境配置与隔离 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T010-local-wechat-simulation/plan.md)。

1. [ ] 契约与装置设计落实，修改 backend/src/bootstrap、compose.yaml、infra/simulation、scripts/simulation。
2. [ ] TDD：生产拒绝模拟端点与缺配置；Compose 变量传递与隔离冒烟。
3. [ ] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t010`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。

