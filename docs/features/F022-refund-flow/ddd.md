# F022 退款流程 DDD

复用 [T006 ddd](../../tasks/T006-wechat-pay-refund/ddd.md) §3.2、决策 [D007/D008/D009](../../tasks/T006-wechat-pay-refund/decisions/)。

## 组件

- `CancelPaidOrderWorkflow`：组 open 时取消已支付订单——同事务：组行锁 → 扣容量（paid/金额）→ Refund requested → 订单 cancelled；组 success → 拒绝走售后。
- `RefundDriver`（Worker 任务 4）：requested → markSubmitted → 渠道提交 → processing/succeeded；processing → 查询 → succeeded/failed。
- `RetryRefund`：仅 failed 且 retryCount < 5；权限/原因/审计由入口保证。
- `RefundResultConfirmer`：渠道证据（回调/查询）唯一可标 succeeded/failed。
- `CreateFullRefundUseCase`：全额退款（含服务费），累计非失败退款 ≤ 实付。
