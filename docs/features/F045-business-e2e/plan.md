# 跨模块完整业务验收 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T011-local-business-acceptance/plan.md)。

1. [x] 契约与装置设计落实，修改 tests/task-suites/t011、tests/helpers、scripts/simulation。
2. [x] TDD 用于发现的缺陷；新增验收装置后验证成功、取消/过期/失败、权限、尾差、部分发货、退款补发、Worker 重启。
3. [x] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t011`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。

