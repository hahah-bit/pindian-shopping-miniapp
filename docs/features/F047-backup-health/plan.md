# 备份恢复与健康检查 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T012-release-readiness/plan.md)。

1. [ ] 契约与装置设计落实，修改 scripts/release、tests/task-suites/t012。
2. [ ] 目标隔离与恢复前校验采用 TDD；真实备份→新隔离项目恢复→核对事实与媒体，不能以文件存在代替恢复。
3. [ ] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t012`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。

