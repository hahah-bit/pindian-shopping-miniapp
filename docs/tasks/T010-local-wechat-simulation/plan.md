# 本地微信模拟联调实施计划

依据：[spec](spec.md)、[DDD](ddd.md)。NestJS/原生微信 TS/Vue3/Vite/PG/Compose 选型保持不变。

1. [ ] F041-environment-isolation：修改 backend/src/bootstrap、compose.yaml、infra/simulation、scripts/simulation；TDD：生产拒绝模拟端点与缺配置；Compose 变量传递与隔离冒烟。 覆盖 AC1，文档先于实现，通过后提交。

2. [ ] F042-wechat-identity-simulator：修改 infra/simulation、scripts/simulation、tests/task-suites/t010；TDD：成功登录、凭证重放/失效、手机号拒绝及渠道失败；生产 HTTP 适配器对本地服务联调。 覆盖 AC2，文档先于实现，通过后提交。

3. [ ] F043-wechat-payment-simulator：修改 infra/simulation、scripts/simulation、tests/task-suites/t010；TDD：查单、签名、密文、处理中/失败/成功退款、重复及迟到回调；真实 API/PG 集成。 覆盖 AC3，文档先于实现，通过后提交。

4. [ ] 接入两端/真实 API 与 Worker 整体联调。
5. [ ] 专项 `npm run test:task:t010`：注册实际目录，覆盖本任务全部条件；成功后 `npm test` 完整回归，均无失败无跳过。
6. [ ] 独立 Compose 构建与 HTTP/后台交互/恢复冒烟；验证记录与提交清单回写。

测试库、临时密钥与构建产物独立且不提交。新增数据库迁移只增不改历史；生产预检的缺环境拒绝是测试场景，不冒充真实渠道联调。脚本幂等或明确重复执行边界，异常可重新运行。用户授权常规功能通过后自动继续，不推送远端。

