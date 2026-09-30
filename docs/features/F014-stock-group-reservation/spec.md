# F014 spec

上游：[T004 spec](../../tasks/T004-group-order-reservation/spec.md) G5、AC02。

## 验收条件

- AC-F14-1 预留：available>0 时条件更新成功；available=0 拒绝（STOCK_INSUFFICIENT）。
- AC-F14-2 并发建组不超卖：库存 2、并发 5 请求 → 恰 2 成功（真实 PG 线程池并发）。
- AC-F14-3 释放/消耗幂等：同业务键重复调用不重复变更；不同键正常变更。
- AC-F14-4 留痕：每次流转一条 movement，resulting 口径正确。
- AC-F14-5 非法输入（负数/零 productId）拒绝。
