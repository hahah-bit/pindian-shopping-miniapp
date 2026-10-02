# 发布演练与交接 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T012-release-readiness/plan.md)。

1. [x] 契约与装置设计落实，修改 scripts/release、docs/tasks/T012-release-readiness、tests/task-suites/t012。
2. [x] 发布目标和版本约束采用 TDD；装配后本地演练发布、重启、恢复。真实审核/到账/触达不计入本轮通过。
3. [x] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t012`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。


位置scripts/release/{package,publish,release-guards}.mjs、docs/tasks/T012-release-readiness/runbook.md；release.test.mjs先红后绿验证schema与源码兼容守卫。先完成F047提交后用真实Git快照打包，rehearsal.test.mjs在同一测试内串行执行发布/恢复/重启/回退以避免竞争。包和演练状态写data/release，含完整源码/可选离线镜像，均不入Git。专项t012→全量→整体健康冒烟；最后中文交接记录。
