-- 0014 库存台账 delta 语义修正（T006）
-- consumeOne（组成功消耗整件）为 reserved→consumed，available 不变，台账 delta=0；
-- 原 CHECK（delta<>0）先于消耗语义，改为有界区间：允许 0 与常规调整幅度，拒绝极端脏数据。
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_delta_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_delta_check CHECK (delta BETWEEN -100000 AND 100000);
