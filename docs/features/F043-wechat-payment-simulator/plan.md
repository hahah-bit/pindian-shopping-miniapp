# 支付退款模拟 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T010-local-wechat-simulation/plan.md)。

1. [ ] 契约与装置设计落实，修改 infra/simulation、scripts/simulation、tests/task-suites/t010。
2. [ ] TDD：查单、签名、密文、处理中/失败/成功退款、重复及迟到回调；真实 API/PG 集成。
3. [ ] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t010`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。

