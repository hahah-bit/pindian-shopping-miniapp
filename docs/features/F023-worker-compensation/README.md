# FF023 worker compensation

- 功能编号：F023
- 所属大任务：[T006](../../tasks/T006-wechat-pay-refund/README.md)；整体设计/决策见 [T006 ddd](../../tasks/T006-wechat-pay-refund/ddd.md)、[spec](../../tasks/T006-wechat-pay-refund/spec.md)、[决策记录](../../tasks/T006-wechat-pay-refund/decisions/)。
- 负责 Agent：当前主 Agent。
- 当前状态：已完成（见 verification.md）。
- 阻塞项：真实商户配置缺失——真实渠道调用不可验证，以测试替身与集成覆盖（如实记录）。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-10-01：完成 spec/plan，进入实现。

## 复验修订

- 2026-10-01 复验修订：组截止任务失效后为 failed 组内已支付且无退款单的订单创建 group_failed 全额退款（逐单事务、幂等重扫、重启恢复）。
- 2026-10-01 第三轮：组截止的整件释放随外层事务回滚（StockReservationPort 贯穿 sessionTx）。
