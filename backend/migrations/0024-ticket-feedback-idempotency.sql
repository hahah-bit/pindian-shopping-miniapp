ALTER TABLE after_sales_tickets DROP CONSTRAINT after_sales_tickets_status_check;
ALTER TABLE after_sales_tickets ADD CONSTRAINT after_sales_tickets_status_check CHECK (status IN ('open','processing','waiting_feedback','resolved','closed'));
ALTER TABLE after_sales_tickets ADD COLUMN client_ticket_id varchar(64);
CREATE UNIQUE INDEX after_sales_user_client_idx ON after_sales_tickets(user_id,client_ticket_id);
