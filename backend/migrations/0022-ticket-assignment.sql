ALTER TABLE after_sales_tickets ADD COLUMN assigned_agent_id uuid REFERENCES admins(id);
-- 保留历史归属未知为 NULL；普通客服不能因此获得历史处理权限，主管可重新处理。
