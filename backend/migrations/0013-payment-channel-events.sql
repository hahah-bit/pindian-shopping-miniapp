-- 0013 渠道事件证据（T006 F021/F023：异常留痕与人工处理入口）
CREATE TABLE payment_channel_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  out_trade_no varchar(64) NOT NULL,
  event_type varchar(32) NOT NULL,
  source varchar(16) NOT NULL CHECK (source IN ('callback', 'query', 'worker')),
  raw_summary jsonb NOT NULL,
  applied_result varchar(32) NOT NULL CHECK (applied_result IN ('applied', 'refunded_not_applied', 'pending_review', 'ignored')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_channel_events_out_trade_no_idx ON payment_channel_events(out_trade_no, created_at DESC);
