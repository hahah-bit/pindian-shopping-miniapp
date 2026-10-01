-- 0016 分份履约（T007 F027）
-- 履约单：一 paid 订单一单（order_id 唯一兜底幂等）；分配数量整数克一次算定不可变；
-- shipped_quantity_grams 为非补发包裹数量冗余（与包裹同事务维护），守恒由聚合校验+CHECK 双保险。
CREATE TABLE fulfillment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  user_id uuid NOT NULL REFERENCES users(id),
  allocated_quantity_grams integer NOT NULL CHECK (allocated_quantity_grams > 0),
  unit varchar(10) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending_shipment' CHECK (status IN ('pending_shipment', 'partially_shipped', 'shipped', 'completed')),
  shipped_quantity_grams integer NOT NULL DEFAULT 0 CHECK (shipped_quantity_grams >= 0),
  receiver_name varchar(20) NOT NULL,
  receiver_phone varchar(20) NOT NULL,
  receiver_province varchar(20) NOT NULL,
  receiver_city varchar(20) NOT NULL,
  receiver_district varchar(20) NOT NULL,
  receiver_detail varchar(120) NOT NULL,
  receiver_version integer NOT NULL DEFAULT 1,
  completed_at timestamptz,
  completed_by varchar(8) CHECK (completed_by IN ('user', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (shipped_quantity_grams <= allocated_quantity_grams)
);
CREATE INDEX fulfillment_orders_group_idx ON fulfillment_orders(group_id);
CREATE INDEX fulfillment_orders_status_idx ON fulfillment_orders(status, updated_at);

-- 包裹：创建即发货事实；运单 (company, tracking_no) 全局唯一；补发不计入发货进度。
CREATE TABLE shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_order_id uuid NOT NULL REFERENCES fulfillment_orders(id),
  quantity_grams integer NOT NULL CHECK (quantity_grams > 0),
  is_reissue boolean NOT NULL DEFAULT false,
  company varchar(30) NOT NULL,
  tracking_no varchar(64) NOT NULL,
  reissue_reason varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company, tracking_no)
);
CREATE INDEX shipments_fulfillment_idx ON shipments(fulfillment_order_id);
