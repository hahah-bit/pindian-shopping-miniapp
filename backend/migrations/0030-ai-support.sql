CREATE TABLE ai_support_conversations (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 window_started_at timestamptz NOT NULL DEFAULT now(), window_requests integer NOT NULL DEFAULT 0
);
CREATE TABLE ai_support_turns (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES ai_support_conversations(user_id) ON DELETE CASCADE,
 client_message_id uuid NOT NULL, text varchar(1000) NOT NULL, reply varchar(4000),
 status varchar(16) NOT NULL CHECK(status IN ('pending','completed','failed')),
 lease_id uuid NOT NULL, lease_expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(user_id,client_message_id), CHECK((status='completed' AND reply IS NOT NULL) OR (status<>'completed' AND reply IS NULL))
);
CREATE INDEX ai_support_user_history_idx ON ai_support_turns(user_id,created_at DESC,id DESC);
