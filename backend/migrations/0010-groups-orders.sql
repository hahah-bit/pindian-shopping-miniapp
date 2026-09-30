-- 0010 拼单组、份额预占、订单（T004 F015）
CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  sale_policy_snapshot jsonb NOT NULL,
  deadline timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'success', 'failed')),
  paid_units integer NOT NULL DEFAULT 0 CHECK (paid_units BETWEEN 0 AND 60),
  reserved_units integer NOT NULL DEFAULT 0,
  paid_amount_fen integer NOT NULL DEFAULT 0 CHECK (paid_amount_fen >= 0),
  paid_goods_amount_fen integer NOT NULL DEFAULT 0 CHECK (paid_goods_amount_fen >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (paid_units + reserved_units <= 60)
);
CREATE INDEX groups_product_status_idx ON groups(product_id, status, deadline);
CREATE INDEX groups_status_deadline_idx ON groups(status, deadline);

CREATE TABLE share_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id),
  order_id uuid NOT NULL UNIQUE,
  units integer NOT NULL CHECK (units IN (30, 20, 15, 12)),
  status varchar(16) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'converted', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_reservations_expiry_idx ON share_reservations(status, expires_at);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no varchar(24) NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  product_id uuid NOT NULL REFERENCES products(id),
  group_id uuid NOT NULL REFERENCES groups(id),
  units integer NOT NULL CHECK (units IN (30, 20, 15, 12)),
  status varchar(16) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'cancelled', 'expired')),
  total_amount_fen integer NOT NULL CHECK (total_amount_fen >= 0),
  goods_amount_fen integer NOT NULL CHECK (goods_amount_fen >= 0),
  service_fee_fen integer NOT NULL CHECK (service_fee_fen >= 0),
  tail_adjust_fen integer NOT NULL DEFAULT 0,
  is_final_order boolean NOT NULL DEFAULT false,
  original_price_fen integer NOT NULL,
  unit varchar(10) NOT NULL,
  whole_quantity_text varchar(16) NOT NULL,
  reference_quantity_text varchar(16) NOT NULL,
  address_receiver_name varchar(20) NOT NULL,
  address_phone varchar(20) NOT NULL,
  address_province varchar(20) NOT NULL,
  address_city varchar(20) NOT NULL,
  address_district varchar(20) NOT NULL,
  address_detail varchar(120) NOT NULL,
  reservation_expires_at timestamptz NOT NULL,
  idempotency_key uuid NOT NULL,
  paid_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount_fen = goods_amount_fen + service_fee_fen)
);
CREATE UNIQUE INDEX orders_user_idempotency_idx ON orders(user_id, idempotency_key);
CREATE INDEX orders_user_created_idx ON orders(user_id, created_at DESC);
CREATE INDEX orders_status_created_idx ON orders(status, created_at DESC);

ALTER TABLE products ADD COLUMN group_deadline_hours integer NOT NULL DEFAULT 24 CHECK (group_deadline_hours BETWEEN 1 AND 168);
