# 登录与手机号模拟 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T010-local-wechat-simulation/plan.md)。

1. [x] 契约与装置设计落实，修改 infra/simulation、scripts/simulation、tests/task-suites/t010。
2. [x] TDD：成功登录、凭证重放/失效、手机号拒绝及渠道失败；生产 HTTP 适配器对本地服务联调。
3. [x] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t010`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。

