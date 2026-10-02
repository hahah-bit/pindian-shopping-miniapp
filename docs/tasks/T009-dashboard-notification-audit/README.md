# T009 基础运营看板、通知与权限审计收尾

- **编号**：T009（唯一；现有功能至 F036、任务至 T008、迁移至 0026）；子功能 F037–F040。
- **目标**：补齐需求第 8/10/11 节的三块收尾能力——①基础运营看板（总览/商品/客服三组指标，用真实订单、支付、退款、履约、客服工单事实统计）；②通知（通知记录 + 投递状态机 + 幂等 + 重试 + 失败查询；客服超时站内提醒主管 D022；小程序消息中心）；③权限与审计收尾（操作日志查询/分页/筛选/脱敏、角色权限矩阵、新权限码，普通客服仍不能审核资金操作）。
- **负责 Agent**：ZCode（GLM）；本次修改目录：`backend/src/contexts/{reporting,notifications,audit,identity-access}`、`backend/src/{bootstrap,workflows}`、`backend/migrations/0027`、`contracts/src`、`apps/admin-web/src`、`apps/mini-program/miniprogram`、`tests/task-suites/t009`、本任务与子功能文档。
- **主领域**：Reporting（统计读模型）、Notifications（通知与投递）、Audit（操作日志查询）；协作：IdentityAccess（权限码、客服主管）、Ordering/GroupBuying/Payments/Fulfillment/CustomerService/AfterSales（只读事实，不改其行为）。
- **前置**：T004（订单/拼单事实）、T006（支付/退款事实）、T007（履约事实）、T008（客服会话/工单/审批事实、F036 权限边界）。
- **当前状态**：已完成（本地开发验收；真实微信渠道/订阅消息外发/真机未验，见 verification）。
- **阻塞项**：无阻塞实现的事项。真实微信渠道（AppSecret/订阅消息模板/商户凭证）与真机仍未接入——按 D021 本轮不实现外发代码，渠道端口预留；验证边界见 verification。

## 工作决策

| 编号 | 议题 | 决策 | 状态 |
| --- | --- | --- | --- |
| D021 | 通知外发渠道范围 | **站内记录+端口预留**：通知记录、投递状态机、幂等键、重试、失败查询、管理端查询全部实现；`NotificationChannel` 端口本轮由"未配置渠道"适配器实现（投递标记 `skipped(channel_not_configured)` 留痕）。微信订阅消息适配器待凭证具备后按 T006 模式另接 | **用户已确认**（2026-10-02，AskUserQuestion 三选一选推荐项） |
| D022 | D018 客服超时提醒 | **站内提醒主管**：Worker 定时扫描超过阈值（默认 15 分钟，可配 `CS_FIRST_RESPONSE_TIMEOUT_MINUTES`）未获客服可见回复的进行中会话，按「会话+主管」幂等生成提醒通知；提醒对象为在线（60 秒内有心跳）`cs_supervisor`，无在线主管时落给全部 active 主管留痕。不自动转派、不改 T008 分配逻辑 | **用户已确认**（同上） |
| D023 | 小程序消息中心 | **做基础消息中心**：本人通知列表（分页）+ 未读数 + 已读标记；开发者工具构建可验，真机未验如实记录 | **用户已确认**（同上） |
| D024 | 看板指标口径 | 时区 Asia/Shanghai 自然日；金额整数分；退款区分申请/受理/到账；各指标精确定义见 [spec 指标口径](spec.md#4-指标口径d024)；拼单成功率=成功/(成功+失败)，无关闭组时为空；拼单耗时用组内订单 MAX(paid_at) 近似成功时刻 | 设计结论（2026-10-02） |
| D025 | 新权限码 | 新增 `reporting:view`（总览+商品，仅 super_admin）、`reporting:view_cs`（客服数据，super_admin+cs_supervisor）、`audit:view`（审计查询与权限矩阵，仅 super_admin）、`notification:manage`（投递查询与手工重试，仅 super_admin）。不新增角色（需求 §6.1 的订单管理员/财务为建议角色，本轮不引入，避免范围膨胀） | 设计结论（2026-10-02，遵循最小权限与既有角色表） |
| D026 | 通知事件接入方式 | **Worker 扫描式事件补抓**（复用 D012 幂等重扫模式）：不改 T006/T008 已验收用例代码；任务按幂等键（如 `refund.succeeded:{refundId}`、`group.succeeded:{orderId}`）扫描补建通知，最终一致（延迟≈扫描间隔），并发由唯一约束兜底 | 设计结论（2026-10-02；避免触碰 T006 四轮修复后的支付确认/退款确认事务） |

## 子功能索引

| 编号 | 名称 | 主领域 | 状态 |
| --- | --- | --- | --- |
| F037 | 运营看板统计查询与管理端页面 | Reporting | 已完成（本地验收，见 [feature verification](../../features/F037-dashboard-reporting/verification.md)） |
| F038 | 通知记录、投递管道与超时提醒 | Notifications | 已完成（本地验收，见 [feature verification](../../features/F038-notification-delivery/verification.md)） |
| F039 | 操作日志查询、权限矩阵与权限码扩展 | Audit / IdentityAccess | 已完成（本地验收，见 [feature verification](../../features/F039-audit-access-query/verification.md)） |
| F040 | 管理端审计/通知页、小程序消息中心与整体联调 | 两端 | 已完成（本地验收，见 [feature verification](../../features/F040-mini-message-integration/verification.md)） |

## 文件索引

- `ddd.md`：领域分析、聚合、不变量、UML（类图/状态图/时序图）。
- `verification.md`：实际验证记录（专项/全量/Docker 冒烟/浏览器交互）。
- `spec.md`：接口契约、指标口径（D024）、权限（D025）、编号化验收条件。
- `plan.md`：实施步骤、TDD 策略判断、专项/全量/Docker 冒烟安排。
- `decisions/`：D021–D026 决策记录。
- 子功能目录 `docs/features/F037..F040/`（各自 README/spec/plan/verification）。
