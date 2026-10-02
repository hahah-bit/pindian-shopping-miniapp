# 备份恢复与健康检查 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T012-release-readiness/plan.md)。

1. [x] 契约与装置设计落实，修改 scripts/release、tests/task-suites/t012。
2. [x] 目标隔离与恢复前校验采用 TDD；真实备份→新隔离项目恢复→核对事实与媒体，不能以文件存在代替恢复。
3. [x] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t012`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。


实际位置scripts/release/{backup,restore,health,docker,backup-guards}.mjs，测试tests/task-suites/t012/backup.test.mjs。目标同源、路径穿越、损坏校验先红后绿；隔离Compose真实数据+媒体备份，new target恢复并核对事实摘要，模拟损坏阻止恢复。源运行状态在finally恢复，失败备份无manifest不能恢复。
