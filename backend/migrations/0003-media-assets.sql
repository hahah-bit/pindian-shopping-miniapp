-- 0003 商品目录：图片资源（F006）
CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key varchar(200) NOT NULL UNIQUE,
  format varchar(8) NOT NULL CHECK (format IN ('jpeg', 'png', 'webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  width integer NOT NULL CHECK (width BETWEEN 60 AND 6000),
  height integer NOT NULL CHECK (height BETWEEN 60 AND 6000),
  sha256 char(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'deleted')),
  uploaded_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX media_assets_created_at_idx ON media_assets(created_at DESC);
