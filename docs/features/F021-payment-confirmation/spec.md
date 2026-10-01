# F021 spec

上游：[T006 spec](../../tasks/T006-wechat-pay-refund/spec.md) §5、AC01/AC02。

## 验收条件

- AC-F21-1 正常确认：预占 converted、组 paid/amount += 、订单 paid、applied=applied（幂等：重复通知同号返回 true 不重复应用）。
- AC-F21-2 组满：支付使 paid 恰 60 → 组 success + consumeOne 整件消耗。
- AC-F21-3 金额不符：pending_review + 订单 unpaid（G10）。
- AC-F21-4 迟到支付：订单 expired → 事实入库 + refunded_not_applied + 全额退款 late_payment（G6/D008）。
- AC-F21-5 组已成功后迟到支付：同样退款。
- AC-F21-6 预占过期（任务未跑兜底）：视为不可生效，退款。
- AC-F21-7 回调与查询竞争：channel_transaction_id 唯一 + applied 幂等。
