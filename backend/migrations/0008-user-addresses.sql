-- 0008 身份权限：收货地址（F011）
CREATE TABLE user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_name varchar(20) NOT NULL CHECK (length(btrim(receiver_name)) BETWEEN 1 AND 20),
  phone varchar(20) NOT NULL CHECK (phone ~ '^1[3-9][0-9]{9}$'),
  province varchar(20) NOT NULL CHECK (length(btrim(province)) BETWEEN 1 AND 20),
  city varchar(20) NOT NULL CHECK (length(btrim(city)) BETWEEN 1 AND 20),
  district varchar(20) NOT NULL CHECK (length(btrim(district)) BETWEEN 1 AND 20),
  detail varchar(120) NOT NULL CHECK (length(btrim(detail)) BETWEEN 5 AND 120),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 同一用户至多一个默认地址（并发设默认的最终防线）
CREATE UNIQUE INDEX user_addresses_single_default_idx ON user_addresses(user_id) WHERE is_default;
CREATE INDEX user_addresses_user_updated_idx ON user_addresses(user_id, updated_at DESC);
