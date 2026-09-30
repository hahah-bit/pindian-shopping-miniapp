-- 0006 身份权限：用户与微信外部身份（F009）
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname varchar(30) NOT NULL CHECK (length(btrim(nickname)) BETWEEN 1 AND 30),
  phone varchar(20),
  phone_country_code varchar(8) NOT NULL DEFAULT '86',
  phone_verified_at timestamptz,
  phone_source varchar(32),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  -- 手机号存在必须伴随验证事实（客户端不能直接提交号码标记验证成功）
  CONSTRAINT users_phone_requires_verification CHECK (
    (phone IS NULL AND phone_verified_at IS NULL) OR (phone IS NOT NULL AND phone_verified_at IS NOT NULL)
  )
);

CREATE TABLE user_wechat_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  openid varchar(64) NOT NULL UNIQUE,
  unionid varchar(64),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bound_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_wechat_identities_user_idx ON user_wechat_identities(user_id);
