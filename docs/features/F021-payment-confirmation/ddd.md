# F021 支付确认 DDD

复用 [T006 ddd](../../tasks/T006-wechat-pay-refund/ddd.md) §3.1、§6.2。核心工作流 ConfirmPaymentWorkflow：

1. 渠道事实入账（channel_transaction_id 唯一，重复通知幂等——Payment.markSucceeded 对同号幂等）。
2. 金额核验（payerTotal vs 订单快照，不符 → pending_review，不生效）。
3. 可生效判定（行锁事务内：订单 unpaid + 预占 reserved 且未过期 + 组 open 未截止）→ 预占 converted + 组 paid/amount += + 订单 paid + 组满判定（60 → success + 整件消耗）。
4. 不可生效 → 事实入库 + 全额自动退款（D008 late_payment）。

关键修正：预占转支付是 reserved→paid 转换，不新占容量——容量检查由 withPaidUnits 的 reserved<0 防护；此前误用"新预占"的 remainingCapacity 检查导致已预占份额永远无法生效。
