-- 0001 身份权限：管理员与会话（F005）
CREATE TABLE admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(32) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_-]{3,32}$'),
  display_name varchar(60) NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 60),
  password_hash text NOT NULL,
  role varchar(32) NOT NULL DEFAULT 'super_admin' CHECK (role IN ('super_admin')),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_admin_id_idx ON admin_sessions(admin_id);
