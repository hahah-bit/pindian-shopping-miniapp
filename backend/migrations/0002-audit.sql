-- 0002 审计：后台操作日志（F005）
CREATE TABLE admin_operation_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  action varchar(64) NOT NULL,
  resource_type varchar(32) NOT NULL,
  resource_id varchar(64),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id varchar(64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_operation_logs_created_at_idx ON admin_operation_logs(created_at DESC);
CREATE INDEX admin_operation_logs_admin_id_idx ON admin_operation_logs(admin_id);
