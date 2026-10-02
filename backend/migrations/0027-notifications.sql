-- 0027 通知记录与投递（T009 F038，D021/D022/D026）
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_admin_id uuid REFERENCES admins(id),
  recipient_user_id uuid REFERENCES users(id),
  event_type varchar(64) NOT NULL,
  title varchar(120) NOT NULL,
  body varchar(500) NOT NULL,
  reference jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key varchar(128) NOT NULL UNIQUE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((recipient_admin_id IS NULL) <> (recipient_user_id IS NULL))
);
CREATE INDEX notifications_user_idx ON notifications(recipient_user_id, created_at DESC);
CREATE INDEX notifications_admin_idx ON notifications(recipient_admin_id, created_at DESC);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id),
  channel varchar(32) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  last_error varchar(500),
  next_attempt_at timestamptz,
  sent_at timestamptz,
  skipped_reason varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);
-- 投递驱动扫描：待发与到期重试
CREATE INDEX notification_deliveries_retry_idx ON notification_deliveries(status, next_attempt_at) WHERE status IN ('pending', 'failed');
-- 管理端按事件类型/状态筛选
CREATE INDEX notification_deliveries_status_idx ON notification_deliveries(status, created_at DESC);
