# F014 整件库存预留生命周期 DDD

复用 [T004 ddd](../../tasks/T004-group-order-reservation/ddd.md) §3.4、决策 [D002](../../tasks/T004-group-order-reservation/decisions/D002-stock-lifecycle.md)。

## 领域服务（Inventory 公开能力 StockReservationPort）

- `reserveOne(productId, idempotencyKey, tx)`：条件更新 `UPDATE stocks SET available=available-1, reserved=reserved+1 WHERE product_id=$1 AND available>0`，受影响 0 行 → STOCK_INSUFFICIENT；留痕 movement（request_id=业务键，唯一索引防重）。
- `releaseOne(productId, idempotencyKey, tx)`：`reserved>0 → available+1, reserved-1`；movement 幂等键防重复释放。
- `consumeOne(productId, idempotencyKey, tx)`：`reserved-1`（转已消耗口径），available 不变。
- 幂等键格式：`group-create:{groupId}`、`group-release:{groupId}`、`group-consume:{groupId}`。唯一冲突时读取已有 movement 校验语义后视为成功（重复调用安全）。

## 一致性边界

组与预留同事务（工作流编排）；组失败/成功由组状态迁移触发同事务库存流转。任何一步失败整体回滚（D002）。
