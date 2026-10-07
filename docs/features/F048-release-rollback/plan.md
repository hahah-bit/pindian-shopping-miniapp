# 发布演练与交接 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T012-release-readiness/plan.md)。

1. [x] 契约与装置设计落实，修改 scripts/release、docs/tasks/T012-release-readiness、tests/task-suites/t012。
2. [x] 发布目标和版本约束采用 TDD；装配后本地演练发布、重启、恢复。真实审核/到账/触达不计入本轮通过。
3. [x] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t012`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。


位置scripts/release/{package,publish,release-guards}.mjs、docs/tasks/T012-release-readiness/runbook.md；release.test.mjs先红后绿验证schema与源码兼容守卫。先完成F047提交后用真实Git快照打包，rehearsal.test.mjs在同一测试内串行执行发布/恢复/重启/回退以避免竞争。包和演练状态写data/release，含完整源码/可选离线镜像，均不入Git。专项t012→全量→整体健康冒烟；最后中文交接记录。

## 2026-10-07 公开源码维护计划

1. 已完成上述DDD/spec维护约定，沿用项目工具和GitHub CLI，现有账号hahah-bit已登录，无新凭据依赖。
2. 加固根.gitignore，使用git check-ignore分别检查真实配置/嵌套变体/凭据文件及示例例外；不改运行配置内容。
3. 本机临时审计脚本读取.env凭据仅用于比对所有Git历史blob；额外检查高置信度令牌与私钥格式。只输出路径/类型/计数，不输出凭据。
4. 检查差异，精确暂存.gitignore和本功能维护文档，中文chore提交；原协调/T005内容不暂存。
5. 审计通过后创建公开hahah-bit/pindian-shopping-miniapp、配置origin并推送main；核对远端SHA及PUBLIC可见性，回写本地结果。

测试策略：本次是Git排除与源码传输维护，无业务/API/部署逻辑变更，不采用TDD，不重复运行应用全量或编写镜像式测试；以实际check-ignore、历史凭据检查、git diff --check与真实远端核验覆盖GH01–03。最新应用验收仍以T015最终专项24/24、全量339/339为准，不能声称本次重跑了它们。
