ALTER TABLE admins DROP CONSTRAINT admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('super_admin','catalog_admin','cs_agent','cs_supervisor'));
CREATE TABLE cs_read_marks (
  conversation_id uuid NOT NULL REFERENCES cs_conversations(id),
  actor_id uuid NOT NULL,
  last_read_seq integer NOT NULL CHECK (last_read_seq >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, actor_id)
);
