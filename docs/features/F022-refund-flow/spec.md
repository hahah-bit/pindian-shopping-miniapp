# F022 spec

上游：[T006 spec](../../tasks/T006-wechat-pay-refund/spec.md) §5、AC03。

## 验收条件

- AC-F22-1 取消已支付：容量即扣（deduct 调用）+ Refund requested（全额含服务费）+ 订单 cancelled。
- AC-F22-2 组已成功后取消 → ORDER_NOT_CANCELLABLE（走售后）。
- AC-F22-3 退款驱动：requested → submitted → 渠道提交 → processing；out_refund_no 为渠道幂等键。
- AC-F22-4 回调确认：仅 SUCCESS 证据可标 succeeded。
- AC-F22-5 累计上限：已有非失败退款单时再次创建 → REFUND_EXCEED_LIMIT。
- AC-F22-6 人工重试：仅 failed 且重试 <5 次；需审计记录 refund.retry。
