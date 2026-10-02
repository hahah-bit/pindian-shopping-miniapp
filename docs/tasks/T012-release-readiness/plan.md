# 部署与运行维护准备实施计划

依据：[spec](spec.md)、[DDD](ddd.md)。NestJS/原生微信 TS/Vue3/Vite/PG/Compose 选型保持不变。

1. [ ] F046-production-deployment：修改 infra/release、compose.production.yaml、scripts/release；配置隔离采用 TDD；装配后在本地隔离环境生成临时 TLS、构建并验证 HTTPS/健康/路由。 覆盖 AC1，文档先于实现，通过后提交。

2. [ ] F047-backup-health：修改 scripts/release、tests/task-suites/t012；目标隔离与恢复前校验采用 TDD；真实备份→新隔离项目恢复→核对事实与媒体，不能以文件存在代替恢复。 覆盖 AC2，文档先于实现，通过后提交。

3. [ ] F048-release-rollback：修改 scripts/release、docs/tasks/T012-release-readiness、tests/task-suites/t012；发布目标和版本约束采用 TDD；装配后本地演练发布、重启、恢复。真实审核/到账/触达不计入本轮通过。 覆盖 AC3，文档先于实现，通过后提交。

4. [ ] 接入两端/真实 API 与 Worker 整体联调。
5. [ ] 专项 `npm run test:task:t012`：注册实际目录，覆盖本任务全部条件；成功后 `npm test` 完整回归，均无失败无跳过。
6. [ ] 独立 Compose 构建与 HTTP/后台交互/恢复冒烟；验证记录与提交清单回写。

测试库、临时密钥与构建产物独立且不提交。新增数据库迁移只增不改历史；生产预检的缺环境拒绝是测试场景，不冒充真实渠道联调。脚本幂等或明确重复执行边界，异常可重新运行。用户授权常规功能通过后自动继续，不推送远端。

