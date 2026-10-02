-- 0018 自建客服与售后工单（T008 F031/F032/F034）
CREATE TABLE cs_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  status varchar(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'ended', 'converted')),
  assigned_agent_id uuid REFERENCES admins(id),
  ticket_id uuid,
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- I6：一个用户至多一个未结束会话
CREATE UNIQUE INDEX cs_conversations_open_user_idx ON cs_conversations(user_id) WHERE status IN ('queued', 'active');
CREATE INDEX cs_conversations_status_idx ON cs_conversations(status, updated_at);

CREATE TABLE cs_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES cs_conversations(id),
  seq integer NOT NULL CHECK (seq > 0),
  sender varchar(8) NOT NULL CHECK (sender IN ('user', 'agent', 'system')),
  kind varchar(8) NOT NULL CHECK (kind IN ('text', 'image', 'card', 'note')),
  content jsonb NOT NULL,
  internal boolean NOT NULL DEFAULT false,
  client_message_id varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, seq),
  UNIQUE (conversation_id, client_message_id)
);
CREATE INDEX cs_messages_conversation_idx ON cs_messages(conversation_id, seq);

CREATE TABLE cs_agent_presence (
  agent_id uuid PRIMARY KEY REFERENCES admins(id),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  active_count integer NOT NULL DEFAULT 0
);

CREATE TABLE after_sales_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  conversation_id uuid REFERENCES cs_conversations(id),
  type varchar(16) NOT NULL CHECK (type IN ('group_issue', 'payment_issue', 'refund_issue', 'product_issue', 'shipment_issue', 'complaint', 'other')),
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'processing', 'resolved', 'closed')),
  title varchar(60) NOT NULL,
  description varchar(2000) NOT NULL,
  related_order_id uuid,
  related_group_id uuid,
  related_refund_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX after_sales_tickets_status_idx ON after_sales_tickets(status, updated_at);
CREATE INDEX after_sales_tickets_user_idx ON after_sales_tickets(user_id);

CREATE TABLE after_sales_ticket_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES after_sales_tickets(id),
  action varchar(24) NOT NULL CHECK (action IN ('create', 'accept', 'reply', 'request_feedback', 'request_refund', 'request_reshipment', 'resolve', 'close', 'user_feedback')),
  actor_type varchar(8) NOT NULL CHECK (actor_type IN ('user', 'agent', 'admin', 'system')),
  actor_id varchar(64),
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX after_sales_ticket_actions_ticket_idx ON after_sales_ticket_actions(ticket_id, created_at);
