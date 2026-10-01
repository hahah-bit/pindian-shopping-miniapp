-- 0012 退款单（T006 F022）
CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  user_id uuid NOT NULL REFERENCES users(id),
  out_refund_no varchar(40) NOT NULL UNIQUE,
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  status varchar(16) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'submitted', 'processing', 'succeeded', 'failed')),
  reason varchar(16) NOT NULL CHECK (reason IN ('user_cancel', 'group_failed', 'late_payment')),
  channel_refund_id varchar(64),
  fail_reason varchar(200),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count <= 50),
  requested_at timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_status_created_idx ON refunds(status, created_at DESC);
CREATE INDEX refunds_user_idx ON refunds(user_id);
