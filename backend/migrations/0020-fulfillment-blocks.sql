CREATE TABLE fulfillment_blocks (
  group_id uuid PRIMARY KEY REFERENCES groups(id),
  reason varchar(32) NOT NULL CHECK (reason IN ('ZERO_ALLOCATION','INVALID_QUANTITY')),
  created_at timestamptz NOT NULL DEFAULT now()
);
