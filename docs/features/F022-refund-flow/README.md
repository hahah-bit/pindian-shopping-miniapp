# FF022 refund flow

- 功能编号：F022
- 所属大任务：[T006](../../tasks/T006-wechat-pay-refund/README.md)；整体设计/决策见 [T006 ddd](../../tasks/T006-wechat-pay-refund/ddd.md)、[spec](../../tasks/T006-wechat-pay-refund/spec.md)、[决策记录](../../tasks/T006-wechat-pay-refund/decisions/)。
- 负责 Agent：当前主 Agent。
- 当前状态：已完成（见 verification.md）。
- 阻塞项：真实商户配置缺失——真实渠道调用不可验证，以测试替身与集成覆盖（如实记录）。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-10-01：完成 spec/plan，进入实现。

## 复验修订

- 2026-10-01 复验修订：退款插入贯穿 sessionTx（与支付确认/取消已支付同事务，真实 PG 故障注入验证回滚）；人工重试重置 requested 并递增 retryCount，由驱动按幂等键重提；退款回调（REFUND.*）经 RefundResultConfirmer 落渠道退款单号。
- 2026-10-01 第三轮：CreateFullRefundUseCase 的支付读取随 sessionTx（事务内一致性读）；迟到退款建单失败→支付回滚→重放恰一笔（真实 PG 回归 confirm-tx.test.mjs）。
- 2026-10-01 第四轮：退款结果确认对重复通知幂等受理（SUCCESS/ABNORMAL/CLOSED 已达成状态不抛错）。
