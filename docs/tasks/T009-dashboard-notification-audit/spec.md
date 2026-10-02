# T009 Spec：基础运营看板、通知与权限审计

业务依据：需求文档 §8 数据统计（8.1 总览 11 项 / 8.2 商品 9 项 / 8.3 客服 10 项）、§9 数据实体（通知记录、操作日志）、§10 异常与安全（管理员操作日志、脱敏）、§11 MVP（13 基础数据看板、14 权限和操作日志）、§5 客服（超过设定时间未回复时提醒客服主管）。

## 1. 目标与范围

**目标**：管理端看板（三组指标）、通知（记录/投递/幂等/重试/失败查询/超时提醒/消息中心）、权限审计收尾（日志查询/权限矩阵/权限码）。

**非目标**：微信订阅消息真实外发与模板配置（D021，待凭证）；短信；自动升级/转派（D022 明确排除）；新角色（D025）；高级报表（需求 §12）；账务级对账精度（看板为运营参考，非财务账簿）。

## 2. 指标口径（D024）

通用约定：时区 **Asia/Shanghai**（`AT TIME ZONE 'Asia/Shanghai'`）的自然日；金额一律**整数分**；统计默认基准日 = 今天（可传 `?date=YYYY-MM-DD` 查历史日）；空数据返回 0 或 `null`（比率无样本时 `null`，前端显示"—"），不返回错误。

### 2.1 总览（`reporting:view`，需求 §8.1 全部 11 项）

| 字段 | 指标 | 口径 |
| --- | --- | --- |
| totalProducts | 商品总数 | `products` 全部状态计数 |
| onShelfProducts | 上架商品数 | `products.status='on_shelf'` |
| openGroups | 进行中拼单数 | `groups.status='open'`（含已过截止未处理的组，Worker 会收敛） |
| successGroups | 成功拼单数 | `groups.status='success'` |
| failedGroups | 失败拼单数 | `groups.status='failed'` |
| todayOrders | 今日订单数 | `orders.created_at` 在基准日（全部状态） |
| todayPaidAmountFen | 今日支付金额 | `orders.status='paid' AND orders.paid_at` 在基准日的 `total_amount_fen` 合计（当日支付后取消/退款的不计，其退款体现在退款指标） |
| serviceFeeIncomeFen | 平台服务费收入 | `orders.status='paid'` 且**无全额成功退款**（不存在 `refunds.status='succeeded' AND amount_fen>=payments.amount_fen`）的 `service_fee_fen` 合计（累计口径） |
| pendingRefundAmountFen | 待退款金额 | `refunds.status IN ('requested','submitted','processing')` 的 `amount_fen` 合计（累计口径） |
| pendingShipmentCount | 待发货订单数 | `fulfillment_orders.status='pending_shipment'`（履约单未生成的极短窗口不计，Worker 秒级生成） |
| csPendingCount | 客服待处理数 | `cs_conversations.status='queued'`（待接入；工单待处理单列于客服数据） |

退款三态拆分（区分申请/受理/到账，随总览一并返回）：`refundRequestedFen`（requested）、`refundAcceptedFen`（submitted+processing，已受理/渠道处理中）、`refundSucceededFen`（succeeded，已到账）。

### 2.2 商品数据（`reporting:view`，需求 §8.2 全部 9 项）

| 字段 | 指标 | 口径 |
| --- | --- | --- |
| stockWholeItems | 商品库存 | `stocks.available_whole_items` 合计 |
| createdGroups | 已创建拼单组数 | `groups` 总数 |
| successGroups / openGroups | 成功/进行中拼单组数 | 同总览 |
| paidUserCount | 参与用户数 | 有至少一笔 `orders.status='paid'` 的去重用户 |
| successRate | 拼单成功率 | `success/(success+failed)`；分母为 0 时 `null` |
| avgGroupDurationMinutes | 平均拼单耗时 | 成功组 `MAX(orders.paid_at)-groups.created_at` 的平均分钟数（`paid_at` 为生效事实；无成功组时 `null`） |
| goodsAmountFen | 商品金额 | `orders.status='paid'` 且无全额成功退款的 `goods_amount_fen` 合计（与服务费同口径，商品+服务费=实付） |
| serviceFeeAmountFen | 平台服务费金额 | 与总览 `serviceFeeIncomeFen` 同口径同值 |
| refundedAmountFen | 退款金额 | `refunds.status='succeeded'` 的 `amount_fen` 合计（已到账） |

### 2.3 客服数据（`reporting:view_cs`，需求 §8.3 全部 10 项 + D022 计数）

| 字段 | 指标 | 口径 |
| --- | --- | --- |
| todayConsultUsers | 今日咨询人数 | 基准日创建会话的去重用户数 |
| queuedCount | 当前排队人数 | `status='queued'` |
| onlineAgentCount | 在线客服数 | `cs_agent_presence.heartbeat_at > now()-60s` 的计数 |
| avgFirstResponseMinutes | 平均首次响应时间 | 基准日创建且已有客服可见回复的会话，`MIN(agent可见消息时间)-created_at` 平均分钟；无样本 `null`（内部备注不算回复） |
| avgSessionDurationMinutes | 平均会话时长 | `status IN ('ended','converted')` 会话 `updated_at-created_at` 平均分钟（以状态更新时刻近似结束时刻，注明近似） |
| unhandledCount | 未处理会话数 | `queued` + `active` 且尚无客服可见回复 |
| ticketCount | 工单数量 | `after_sales_tickets` 总数 |
| ticketResolveRate | 工单解决率 | `(resolved+closed)/total`；无工单 `null` |
| ticketTypeStats | 问题类型统计 | 按 `type` 分组计数（7 类固定枚举） |
| agentLoad | 客服人员接待量 | 按 `cs_conversations.assigned_agent_id` 分组计数（含 display_name；未分配不计入个人） |
| overdueFirstResponseCount | 超时未回复会话数 | 进行中（queued/active）、无客服可见回复且 `created_at < now()-15min`（D022 阈值） |

## 3. 接口契约

包络沿用 `ApiResponse<T>`（`{data, requestId}`）、分页 `PageView<T>`、错误 `ApplicationError`→HTTP 映射、`Authorization: Bearer`；金额字段一律 `*Fen` 整数分；时间 ISO 字符串。

### 3.1 看板（F037）

- `GET /api/admin/v1/reporting/overview?date=YYYY-MM-DD` → `{ overview: <2.1 字段>, product: <2.2 字段> }`，需 `reporting:view`，否则 403 `FORBIDDEN`；`date` 非法 400 `VALIDATION_FAILED`。
- `GET /api/admin/v1/reporting/customer-service?date=YYYY-MM-DD` → `<2.3 字段>`，需 `reporting:view_cs`。
- 响应附 `generatedAt`（统计时点）与 `date`（实际基准日）。

### 3.2 通知（F038/F040）

管理端（需 `notification:manage`）：
- `GET /api/admin/v1/notifications/deliveries?status=&channel=&eventType=&page=&pageSize=` → `PageView<AdminDeliveryListItem>`；行含 `id, notificationId, eventType, title, recipientType('admin'|'user'), recipientName(脱敏昵称/显示名), channel, status, attemptCount, maxAttempts, lastError, nextAttemptAt, sentAt, skippedReason, createdAt`。
- `POST /api/admin/v1/notifications/deliveries/{id}/retry` → 仅 `failed` 可重试（重置 pending、attemptCount=0），成功返回更新后行；对 `sent/skipped/pending` 返回 409 `DELIVERY_NOT_RETRYABLE`；写审计 `notification.retry`。

小程序（需用户登录，仅本人）：
- `GET /api/mini/v1/notifications?page=&pageSize=` → `{ items: NotificationRecordView[], page, pageSize, total, unreadCount }`；`NotificationRecordView = { id, eventType, title, body, reference, readAt, createdAt }`。
- `POST /api/mini/v1/notifications/{id}/read` → 本人通知置 `readAt`（幂等，重复调用返回 200 且保持首次时间）；他人/不存在 404 `NOT_FOUND`。

### 3.3 审计与权限矩阵（F039）

- `GET /api/admin/v1/audit/logs?adminId=&action=&resourceType=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&pageSize=` → `PageView<AdminAuditLogItem>`，需 `audit:view`；行含 `id, adminId, adminDisplayName, action, resourceType, resourceId, detail(脱敏后), requestId, createdAt`；from/to 为 Asia/Shanghai 自然日边界（含 to 当日）。
- `GET /api/admin/v1/access/role-matrix` → `{ roles: [{ role, label, permissions }] }`，需 `audit:view`。
- 脱敏规则：`detail` 递归遍历，`phone`/`telephone` 键与匹配大陆手机号模式的字符串值 → `前3****后4`；日志库内数据不改。

### 3.4 权限码（D025）

`reporting:view`（super_admin）、`reporting:view_cs`（super_admin、cs_supervisor）、`audit:view`（super_admin）、`notification:manage`（super_admin）。普通客服（cs_agent）对以上全部 403；**资金审核权限边界不变**（F036 既有断言保持通过）。

## 4. 通知业务规则（D021/D022/D026）

1. 事件类型与幂等键：`group.succeeded:{orderId}`（用户）、`refund.succeeded:{refundId}`（用户）、`cs.conversation.timeout:{conversationId}:{adminId}`（主管）。标题/正文模板见 plan 实现细节；`reference` 携带业务 ID 供消息中心跳转。
2. 通知创建即生成 `wechat_subscribe_message` 初始投递（pending）；本轮渠道适配器恒返回 `skipped(channel_not_configured)`（D021），故正常路径投递记录最终为 skipped 留痕——**这验证了管道，不冒充外发成功**。
3. 投递驱动任务：扫描 pending 与到期 failed（退避 1/2/4/8/16 分钟，上限 5 次）；条件更新防并发重复发送。
4. 超时提醒：阈值 `CS_FIRST_RESPONSE_TIMEOUT_MINUTES`（默认 15，正整数，worker 启动读取）；提醒对象=心跳 60 秒内的 `cs_supervisor`，无则全部 active 主管；每会话×主管恰一条。
5. 管理员手工重试仅对 failed（I6），审计 `notification.retry`。

## 5. 页面状态（F037/F040，AGENTS §2.1-2）

- **看板页 `/reporting`**：正常（三区块卡片+刷新+日期选择）、加载（禁用+文案）、空数据（全 0/“—”，不报错）、失败（`role="alert"` 错误+重试）、无权限（super_admin 以外看到 403 提示；cs_supervisor 仅隐藏总览/商品区块、显示客服区块）。
- **权限与审计页 `/access`**：正常（日志表格+筛选+分页+角色矩阵）、空数据（“暂无日志”）、失败（错误+重试）、无权限（403 提示）。
- **通知投递页 `/notifications`**：正常（表格+状态/渠道筛选+分页+failed 行重试按钮）、空数据、失败、无权限（403）；skipped 行重试按钮禁用。
- **小程序消息中心**：正常（列表+未读徽标+下拉进入自动标记可见已读？——v1 仅点击置已读）、加载、空数据（“暂无消息”）、未登录（引导登录）、失败（重试）。

## 6. 验收条件（编号化）

- **A1 指标准确**：给定构造数据（多商品/组/订单/支付/退款/履约/会话/工单，含跨 Asia/Shanghai 日界数据），三个看板端点返回值与 SQL 手工核对一致（含金额分、比率、null 场景）。
- **A2 空数据**：全新基准日/空库返回 0 与 null，HTTP 200。
- **A3 权限**：cs_agent 访问四个新权限端点全 403；cs_supervisor 可访问客服数据、总览 403；catalog_admin 总览 403；未认证 401。
- **A4 通知幂等**：同一退款事实/同一超时会话重复扫描不产生重复通知与投递（唯一约束兜底，双实例并发也恰一条）。
- **A5 投递状态机**：未配置渠道→skipped(channel_not_configured) 终态；注入渠道失败→failed 并按上限重试；仅 failed 可手工重试，其余 409；重试写审计。
- **A6 超时提醒**：超阈值未首响会话对在线主管各生成一条提醒；已首响/新会话不生成；阈值从环境变量生效。
- **A7 审计查询**：分页正确、adminId/action/resourceType/时间范围筛选正确、手机号在响应中脱敏、无权限 403。
- **A8 消息中心**：仅本人通知可见（他人 404）、未读数正确、已读幂等。
- **A9 回归**：T001–T008 既有专项与全量测试零跳过通过（权限断言因新增权限码更新处仅限扩展，不放宽既有断言）。
- **A10 边界如实**：verification 明确记录真实微信渠道、订阅消息外发、真机未验证；D021 下 skipped≠发送成功。

## 7. 待决策项

无阻塞实现项。后续接入真实渠道时需：小程序 AppSecret、订阅消息模板 ID、用户授权（`requestSubscribeMessage`）交互设计——按 T006 模式另立任务。
