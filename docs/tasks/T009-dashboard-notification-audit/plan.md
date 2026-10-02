# T009 Plan

对应 [spec](spec.md)、[ddd](ddd.md)；覆盖验收 A1–A10。前置阻塞：无（D021/D022/D023 已用户确认）。

## 1. 测试策略判断（AGENTS §2.2）

- **采用 TDD**：看板指标计算（金额/比率/时区边界）、投递状态机与幂等、超时会话筛选、审计筛选与脱敏、权限码映射——均为可自动验证的业务规则；先写测试确认红（模块缺失/断言失败），再实现转绿。
- **不采用 TDD（实现后验证）**：管理端三个页面、小程序消息中心页的布局与状态展示——不改后端业务行为，以构建 + 有数据浏览器交互验证。
- 专项测试范围：`tests/task-suites/t009/`（指标、通知、审计、权限单测 + 真实 PG 集成）；全量：`npm test`；环境冒烟：隔离 Docker 构建（复用 remediation 轮的隔离项目名方式）。

## 2. 实施步骤（按依赖顺序）

1. **共享契约与权限码**：`contracts/src/index.ts`（T009 类型 + AdminPermission 扩展）、`backend/src/contexts/identity-access/domain/role.ts`（ROLE_PERMISSIONS，D025）。完成标准：typecheck 通过。
2. **迁移 0027**：`notifications` / `notification_deliveries` 表与索引（ddd §2.1），幂等键唯一、投递 (notification_id, channel) 唯一、重试部分索引。完成标准：`npm run migrate` 于本地库成功、重复执行幂等。
3. **F037 看板**（TDD）：`reporting` 上下文 domain（投影类型）/ application（`ReportingQueries` 用例 + 端口）/ adapters/outbound/postgres（SQL 投影）/ adapters/inbound/admin 控制器（权限标记、date 校验、钳制）；`foundation.module` 装配；`context-registry` 更新。测试：t009 `reporting-metrics.test.mjs`（真实 PG 种子数据逐指标断言 + 日界 + 空数据）。
4. **F038 通知**（TDD）：`notifications` 上下文 domain（聚合 + 状态机规则）/ application（Recorder、DeliveryDriver、TimeoutReminder 用例 + 端口 `NotificationChannelPort`、`NotificationRepository`）/ adapters/outbound（PG 仓储、UnconfiguredChannelAdapter、扫描 SQL）/ adapters/inbound（admin 投递查询+重试、mini 消息中心）；worker.ts 挂 `NotificationDeliveryTask` + `CsTimeoutReminderTask` + 事件补抓任务；config 增加 `CS_FIRST_RESPONSE_TIMEOUT_MINUTES`。测试：t009 `notification-pipeline.test.mjs`（状态机/幂等/重试上限 PG 级）+ 集成。
5. **F039 审计查询**（TDD）：`audit` application（`AuditLogQueries` + 查询端口）/ outbound（PG 分页筛选 + 脱敏）/ inbound 控制器（logs + role-matrix）。测试：t009 `audit-query.test.mjs`。
6. **F040 前端与联调**：管理端 `ReportingDashboardView` / `AccessAuditView` / `AdminNotificationsView` + 路由挂载 + api-client 函数；小程序 `features/notifications`（页面 + `notification-api.ts` + profile 入口 + app.json 注册）；集成测试 t009 `integration-db-http.test.mjs`（A1–A8 端到端 + 权限 + 幂等 + 重试审计）。
7. **专项 → 全量 → Docker 冒烟**：`npm run test:task:t009`（注册到 run-all-tests.mjs taskDirs 与 package.json）→ `npm test` → 隔离 Docker 构建 + smoke。
8. **文档回写**：README/F037-F040 状态、各 feature verification、任务 verification。

## 3. 通知文案模板（实现细节固定）

- `group.succeeded`：题「拼单成功」；文「您参与的拼单已成功，将按份额履约发货」；reference `{groupId, orderId}`。
- `refund.succeeded`：题「退款到账」；文「您的退款已到账（原路退回），金额 x.xx 元」；reference `{orderId, refundId}`。
- `cs.conversation.timeout`：题「会话超时提醒」；文「会话 {短ID} 超过 {阈值} 分钟未回复，请关注」；reference `{conversationId}`。

## 4. 存储设计

迁移 0027（仅新增，无既有表变更）：

```sql
notifications(id, recipient_admin_id FK admins, recipient_user_id FK users,
  event_type varchar(64), title varchar(120), body varchar(500), reference jsonb,
  idempotency_key varchar(128) UNIQUE, read_at timestamptz, created_at)
  + CHECK (恰好一个 recipient) + 用户/主管查询索引
notification_deliveries(id, notification_id FK, channel varchar(32), status CHECK IN (pending,sent,skipped,failed),
  attempt_count int, max_attempts int, last_error varchar(500), next_attempt_at, sent_at, skipped_reason varchar(64),
  created_at, updated_at, UNIQUE(notification_id, channel))
  + 重试部分索引 (status, next_attempt_at) WHERE status IN ('pending','failed')
```

兼容性：纯新增，不触碰既有表；回滚 = 不部署（迁移向前-only，与既有迁移约定一致）。

## 5. 验证安排

| 阶段 | 内容 | 通过标准 |
| --- | --- | --- |
| 子功能 | 各 F 的 TDD 测试与构建 | 红→绿记录于各 feature verification |
| **专项** | `npm run test:task:t009` | 全部用例 0 失败 0 跳过（真实 PG 环境可用时；环境缺失如实记录，不得当作通过） |
| **全量** | `npm test`（typecheck+build+架构检查+全部任务套件） | 0 失败 0 跳过 |
| **环境冒烟** | 隔离项目名 Docker 构建 + smoke-docker 脚本 + API/Worker/迁移健康 | 4 容器 healthy、迁移至 0027、Worker 新任务运行、skipped 投递留痕可见 |
| 未验项 | 真实微信渠道/订阅消息外发/真机 | verification 如实记录（A10） |

## 6. 完成标准

spec A1–A10 全部满足或如实记录边界；专项+全量+Docker 冒烟通过；文档状态回写；仅提交 T009 相关文件（排除 T005 与 coordination 未提交内容）。
