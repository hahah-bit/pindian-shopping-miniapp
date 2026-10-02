CREATE TABLE cs_images (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES cs_conversations(id),
  actor_id uuid NOT NULL,
  format varchar(8) NOT NULL CHECK (format IN ('png','jpeg','webp')),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 5242880),
  created_at timestamptz NOT NULL
);
CREATE INDEX cs_images_conversation_idx ON cs_images(conversation_id);
