ALTER TABLE refunds DROP CONSTRAINT refunds_reason_check;
ALTER TABLE refunds ADD CONSTRAINT refunds_reason_check CHECK(reason IN ('user_cancel','group_failed','late_payment','after_sales'));
ALTER TABLE after_sales_ticket_actions DROP CONSTRAINT after_sales_ticket_actions_action_check;
ALTER TABLE after_sales_ticket_actions ADD CONSTRAINT after_sales_ticket_actions_action_check CHECK(action IN ('create','accept','reply','request_feedback','request_refund','request_reshipment','resolve','close','user_feedback','approve_refund','reject_refund','approve_reshipment','reject_reshipment'));
CREATE TABLE after_sales_action_requests (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES after_sales_tickets(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  requester_id uuid NOT NULL REFERENCES admins(id),
  client_request_id varchar(64) NOT NULL,
  kind varchar(16) NOT NULL CHECK(kind IN ('refund','reshipment')),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','executed','rejected')),
  reason varchar(1000) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  amount_fen integer,
  reviewer_id uuid REFERENCES admins(id),
  review_reason varchar(1000),
  result_id uuid,
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz,
  UNIQUE(requester_id,client_request_id),
  CHECK((kind='refund' AND amount_fen>0) OR (kind='reshipment' AND amount_fen IS NULL)),
  CHECK((status='pending' AND reviewer_id IS NULL AND result_id IS NULL AND reviewed_at IS NULL) OR (status='executed' AND reviewer_id IS NOT NULL AND result_id IS NOT NULL AND reviewed_at IS NOT NULL) OR (status='rejected' AND reviewer_id IS NOT NULL AND result_id IS NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX after_sales_requests_ticket_idx ON after_sales_action_requests(ticket_id,created_at);
CREATE TABLE fulfillment_refund_holds (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  refund_id uuid NOT NULL REFERENCES refunds(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
