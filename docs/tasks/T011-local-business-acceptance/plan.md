# 两端交互与完整业务验收实施计划

依据：[spec](spec.md)、[DDD](ddd.md)。NestJS/原生微信 TS/Vue3/Vite/PG/Compose 选型保持不变。

1. [ ] F044-mini-page-harness：修改 tests/helpers/mini-page、tests/task-suites/t011；不采用 TDD（测试装置/页面装配），实现后冒烟实际页面；微信渲染与真机单列待验。 覆盖 AC1，文档先于实现，通过后提交。

2. [ ] F045-business-e2e：修改 tests/task-suites/t011、tests/helpers、scripts/simulation；TDD 用于发现的缺陷；新增验收装置后验证成功、取消/过期/失败、权限、尾差、部分发货、退款补发、Worker 重启。 覆盖 AC2，文档先于实现，通过后提交。

3. [ ] 接入两端/真实 API 与 Worker 整体联调。
4. [ ] 专项 `npm run test:task:t011`：注册实际目录，覆盖本任务全部条件；成功后 `npm test` 完整回归，均无失败无跳过。
5. [ ] 独立 Compose 构建与 HTTP/后台交互/恢复冒烟；验证记录与提交清单回写。

测试库、临时密钥与构建产物独立且不提交。新增数据库迁移只增不改历史；生产预检的缺环境拒绝是测试场景，不冒充真实渠道联调。脚本幂等或明确重复执行边界，异常可重新运行。用户授权常规功能通过后自动继续，不推送远端。

