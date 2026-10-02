-- F038 独立复验：认领租约与业务退避时间分离，令牌防止过期持有者覆盖。
ALTER TABLE notification_deliveries ADD COLUMN lease_token uuid;
ALTER TABLE notification_deliveries ADD COLUMN lease_until timestamptz;
CREATE INDEX notification_delivery_lease_idx ON notification_deliveries(lease_until) WHERE status IN ('pending','failed');
