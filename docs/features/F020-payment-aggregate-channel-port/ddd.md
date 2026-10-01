# F020 支付单与渠道端口 DDD

复用 [T006 ddd](../../tasks/T006-wechat-pay-refund/ddd.md) §3.1（Payment 不变量）、§8（端口）。补充细节。

## Payment 细节

- `create`（processing，含 prepayId）、`createUnknown`（外部超时，prepayId='pending-query' 占位、prepayUsable=false）。
- `prepayUsable(now)`：processing/unknown 且 prepayId 有效且未过期（2h，官方核验 2026-10-01）。
- `markSucceeded`：closed 不可标成功；渠道交易号不一致抛错（防串单）。
- `markAppliedResult`：applied/refunded_not_applied/pending_review 互斥且不可变（幂等）。

## 渠道端口

`PaymentChannelPort`（createJsapiOrder/queryOrderByOutTradeNo/closeOrder/signPayParams + 退款方法见 F022）；错误码语义映射：CHANNEL_TIMEOUT→unknown、OUT_TRADE_NO_USED→查单恢复、NOT_CONFIGURED→503。
