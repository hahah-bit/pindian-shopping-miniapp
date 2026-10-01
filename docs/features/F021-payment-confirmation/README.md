# FF021 payment confirmation

- 功能编号：F021
- 所属大任务：[T006](../../tasks/T006-wechat-pay-refund/README.md)；整体设计/决策见 [T006 ddd](../../tasks/T006-wechat-pay-refund/ddd.md)、[spec](../../tasks/T006-wechat-pay-refund/spec.md)、[决策记录](../../tasks/T006-wechat-pay-refund/decisions/)。
- 负责 Agent：当前主 Agent。
- 当前状态：已完成（见 verification.md）。
- 阻塞项：真实商户配置缺失——真实渠道调用不可验证，以测试替身与集成覆盖（如实记录）。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-10-01：完成 spec/plan，进入实现。

## 复验修订

- 2026-10-01 复验修订：确认工作流事务化——应用、支付事实与迟到退款同事务，退款建单失败整体回滚可重放；组 success 同事务落 D006 让利台账（group_settlements）；支付结果刷新（POST :id/payment-result）在 processing/unknown 时主动渠道查单。
- 2026-10-01 第三轮：生产仓储事务贯穿（PaymentRepository.save 会话连接）；库存消耗随外层事务回滚（真实 PG 故障回归）；回调与查询并发 exactly-once（集成）。
- 2026-10-01 第四轮：确认判定全部移入组锁内（锁内重读订单/支付），已生效事实优先于组状态；并发确认 exactly-once（真实 PG 双实例回归）。
