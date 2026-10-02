# 小程序页面交互测试 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T011-local-business-acceptance/plan.md)。

1. [ ] 契约与装置设计落实，修改 tests/helpers/mini-page、tests/task-suites/t011。
2. [ ] 不采用 TDD（测试装置/页面装配），实现后冒烟实际页面；微信渲染与真机单列待验。
3. [ ] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t011`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。

