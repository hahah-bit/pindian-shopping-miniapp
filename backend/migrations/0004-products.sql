-- 0004 商品目录：商品与商品图片关联（F007）
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(60) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  description varchar(2000) NOT NULL DEFAULT '',
  original_price_fen integer NOT NULL CHECK (original_price_fen BETWEEN 1 AND 99999999),
  whole_quantity numeric(12,3) NOT NULL CHECK (whole_quantity > 0),
  unit varchar(10) NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 10),
  allowed_share_units integer[] NOT NULL
    CHECK (allowed_share_units <> '{}' AND allowed_share_units <@ ARRAY[30,20,15,12]::integer[]),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'on_shelf', 'off_shelf')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_status_created_idx ON products(status, created_at DESC);

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id),
  role varchar(8) NOT NULL CHECK (role IN ('main', 'detail')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 每个商品至多一张主图
CREATE UNIQUE INDEX product_images_single_main_idx ON product_images(product_id) WHERE role = 'main';
-- 同一资源在同一商品内至多关联一次
CREATE UNIQUE INDEX product_images_product_media_idx ON product_images(product_id, media_asset_id);
CREATE INDEX product_images_media_idx ON product_images(media_asset_id);
