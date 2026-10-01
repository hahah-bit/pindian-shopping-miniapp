# F020 spec

上游：[T006 spec](../../tasks/T006-wechat-pay-refund/spec.md) §3/§5、AC01。

## 验收条件

- AC-F20-1 正常发起：金额来自订单快照（16833）、outTradeNo=orderId、processing + 调起参数（RSA）。
- AC-F20-2 幂等：prepay 2h 内复用同一支付单，渠道只调一次。
- AC-F20-3 越权：非本人订单 NOT_FOUND。
- AC-F20-4 不可支付：订单 cancelled/expired、组已结束 → ORDER_NOT_PAYABLE；预占过期 → 同。
- AC-F20-5 未配置：503 WECHAT_PAY_NOT_CONFIGURED，不建支付单。
- AC-F20-6 外部超时：unknown（不认定失败），落库待查询接管（G8）。
- AC-F20-7 同号已用：查询 SUCCESS → 恢复为 succeeded（来源 query）；NOTPAY → 恢复 processing 占位。
