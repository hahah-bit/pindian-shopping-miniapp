ALTER TABLE products ADD COLUMN category varchar(16) NOT NULL DEFAULT 'other' CHECK (category IN ('fruit','snack','drink','other'));
CREATE INDEX products_shelf_category_idx ON products(category, created_at DESC, id DESC) WHERE status='on_shelf';
