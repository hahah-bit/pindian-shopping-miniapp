-- 0011 支付单（T006 F020）
CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id),
  user_id uuid NOT NULL REFERENCES users(id),
  amount_fen integer NOT NULL CHECK (amount_fen > 0),
  status varchar(16) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'processing', 'succeeded', 'closed', 'unknown')),
  out_trade_no varchar(64) NOT NULL UNIQUE,
  channel_transaction_id varchar(64) UNIQUE,
  applied_result varchar(32) CHECK (applied_result IN ('applied', 'refunded_not_applied', 'pending_review')),
  prepay_id varchar(64),
  prepay_expires_at timestamptz,
  success_source varchar(16) CHECK (success_source IN ('callback', 'query')),
  channel_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_status_updated_idx ON payments(status, updated_at);
