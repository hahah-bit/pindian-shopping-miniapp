-- 0009 库存：业务幂等键（T004 F014 组预留/释放/消耗防重）
ALTER TABLE stock_movements ADD COLUMN business_key varchar(64);
-- 同商品同业务键（group-create:{groupId} 等）只允许一条流转记录
CREATE UNIQUE INDEX stock_movements_business_key_idx ON stock_movements(product_id, business_key) WHERE business_key IS NOT NULL;
