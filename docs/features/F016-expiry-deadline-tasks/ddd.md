# F016 预占过期与组截止任务 DDD

复用 [T004 ddd](../../tasks/T004-group-order-reservation/ddd.md) §6.3，决策 [D002](../../tasks/T004-group-order-reservation/decisions/D002-stock-lifecycle.md)/[D004](../../tasks/T004-group-order-reservation/decisions/D004-time-and-quantity.md)。

## ExpireReservationsTask

- SELECT 预占 WHERE status='reserved' AND expires_at<now() FOR UPDATE SKIP LOCKED。
- 每笔独立事务：预占→expired（条件更新）；组行锁 reserved_units−=units；订单 unpaid→expired。
- 重复执行：状态条件天然幂等；SKIP LOCKED 支持多实例/重启后并行安全。

## FailDeadlineGroupsTask

- SELECT 组 WHERE status='open' AND deadline<now()。
- 每组事务：组行锁 → 残留预占→expired + 订单→expired + reserved_units 归零 → 组→failed → 库存释放（releaseOne，业务键幂等）。
- 本阶段组失败时组内无已支付订单（支付未接入）；已支付+截止的退款流程留待支付阶段（spec 记录边界）。
