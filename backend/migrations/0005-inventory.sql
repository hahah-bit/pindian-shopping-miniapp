-- 0005 库存：整件库存与变动记录（F007）
CREATE TABLE stocks (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  available_whole_items integer NOT NULL CHECK (available_whole_items >= 0),
  reserved_whole_items integer NOT NULL DEFAULT 0 CHECK (reserved_whole_items >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  resulting_available integer NOT NULL CHECK (resulting_available >= 0),
  reason varchar(200) NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 200),
  actor_admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 同商品同幂等键只允许一条变动
CREATE UNIQUE INDEX stock_movements_idempotency_idx ON stock_movements(product_id, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX stock_movements_product_created_idx ON stock_movements(product_id, created_at DESC);
