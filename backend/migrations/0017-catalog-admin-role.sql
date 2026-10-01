-- 0017 商品管理员角色（T007 R07：需求 §6.1 角色拆分；覆盖无 order:manage 的有效管理员 403 验证）
ALTER TABLE admins DROP CONSTRAINT admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('super_admin', 'catalog_admin'));
