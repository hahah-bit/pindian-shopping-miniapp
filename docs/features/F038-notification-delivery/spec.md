# F038 Spec

引用 [T009 spec](../../tasks/T009-dashboard-notification-audit/spec.md) §3.2/§4、[ddd](../../tasks/T009-dashboard-notification-audit/ddd.md) §2.1/§4（状态机 I4-I6）、验收 A4/A5/A6/A10；补充细节：

## 领域规则
- `Notification.create()` 校验：eventType 非空、标题≤120、正文≤500、接收者恰一、幂等键非空；投递初始行 channel=`wechat_subscribe_message`、status=pending、maxAttempts=5。
- `Delivery.recordAttempt(outcome)`：sent→sentAt 终态；skipped→reason 终态；failed→lastError、attemptCount+1、nextAttemptAt=now+退避（2^n 分钟）；attemptCount≥maxAttempts 保持 failed（不再自动重试）。
- `Delivery.resetForManualRetry()`：仅 failed 允许（否则 409 `DELIVERY_NOT_RETRYABLE`）；重置 pending、attemptCount=0、清空 lastError/nextAttemptAt。
- `Notification.markRead(userId, now)`：仅接收者本人（否则 NOT_FOUND 语义）；已读幂等保留首次 readAt。

## 用例
- `RecordNotification`（幂等键冲突→返回已存在通知，语义为成功）。
- `DriveDeliveries`（扫描 pending/到期 failed → channel.send → recordAttempt，条件更新防并发）。
- `RetryDelivery`（管理端，审计 `notification.retry`）。
- `CatchUpBusinessEvents`（D026：refund.succeeded / group.succeeded 补抓）。
- `ScanTimeoutConversations`（D022：超时筛选 + 主管选择 + 幂等建提醒）。

## 端点与配置
- 管理端/小程序端点见 T009 spec §3.2；`CS_FIRST_RESPONSE_TIMEOUT_MINUTES`（默认 15）入 config。
- Worker 启动日志列出新任务。

## 验收条件
- A4.1 同幂等键重复创建返回同一通知、无新投递；A4.2 两 Worker 并发扫描（真实 PG）通知数恰一。
- A5.1 未配置渠道→skipped(channel_not_configured)；A5.2 注入失败适配器→failed、退避重试、达上限停；A5.3 sent/skipped/pending 手工重试 409；A5.4 failed 重试后审计恰一条。
- A6.1 超时未首响会话对在线主管各生成一条提醒；A6.2 已首响/新鲜会话不生成；A6.3 二次扫描无重复；A6.4 阈值环境变量生效。
