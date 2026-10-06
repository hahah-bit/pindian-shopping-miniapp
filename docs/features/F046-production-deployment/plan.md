# 生产部署配置 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T012-release-readiness/plan.md)。

1. [x] 契约与装置设计落实，修改 infra/release、compose.production.yaml、scripts/release。
2. [x] 配置隔离采用 TDD；装配后在本地隔离环境生成临时 TLS、构建并验证 HTTPS/健康/路由。
3. [x] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t012`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。


具体修改：compose.production.yaml、infra/release/nginx.conf、infra/docker/start-api.cjs、scripts/release/preflight.mjs；Dockerfile 复制入口。先写启动配置核心校验回归（无凭据/模拟被拒），再装配后 docker compose config 与本地临时 HTTPS 冒烟。演练覆盖生产拓扑，APP_ENV 明确 simulation，不能写作真实生产凭据验收。

## T013复验发现的临时TLS续建修订（2026-10-06，实现前）
先测试证书有效期判断（充足/到期/将到期/无效），再实现初始化续建；重新执行T012演练专项，通过后再执行项目全量。

同次复验发现：初始化构建独立working镜像，却将演练env写成不存在的封存镜像标签，恢复实际失败。生成env须直接引用rehearsalImageTags输出；保留封存镜像不可覆盖约束，实际隔离恢复验证。
