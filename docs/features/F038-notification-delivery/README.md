# F038 通知记录、投递管道与超时提醒

- **编号**：F038；所属大任务 [T009](../../tasks/T009-dashboard-notification-audit/README.md)。
- **目标**：`notifications` 上下文落地：Notification 聚合（幂等键、已读）+ Delivery 实体（状态机、重试上限）+ 未配置渠道适配器（D021）+ Worker 三任务（投递驱动 / 客服超时提醒 D022 / 事件补抓 D026）+ 管理端投递查询与手工重试。
- **主领域**：Notifications；**协作**：CustomerService（超时扫描只读）、Payments/GroupBuying（事件补抓只读）、IdentityAccess（主管选择）、Audit（重试审计）。
- **负责 Agent**：ZCode（GLM）；**修改目录**：`backend/src/contexts/notifications/`、`backend/src/bootstrap/{foundation.module.ts,worker.ts,config.ts,context-registry.ts}`、`backend/migrations/0027-*.sql`、`contracts/src`、`tests/task-suites/t009/`。
- **前置**：T006（退款事实）、T008（会话事实）；**当前状态**：已完成（本地验收，见 verification.md）；**阻塞项**：无。
