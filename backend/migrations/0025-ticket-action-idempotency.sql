ALTER TABLE after_sales_ticket_actions ADD COLUMN client_action_id varchar(64);
CREATE UNIQUE INDEX ticket_action_actor_client_key
  ON after_sales_ticket_actions(ticket_id, actor_type, actor_id, client_action_id)
  WHERE client_action_id IS NOT NULL;
