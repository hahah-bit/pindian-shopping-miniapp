# 生产部署配置 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[整体 plan](../../tasks/T012-release-readiness/plan.md)。

1. [ ] 契约与装置设计落实，修改 infra/release、compose.production.yaml、scripts/release。
2. [ ] 配置隔离采用 TDD；装配后在本地隔离环境生成临时 TLS、构建并验证 HTTPS/健康/路由。
3. [ ] 相关测试/冒烟通过，写 verification，中文提交。

验证：对应 `tests/task-suites/t012`；大任务收尾专项通过后运行全量，不以子功能检查替代整体。兼容现有接口，凭据及测试数据不入 Git。

