# T002 商品展示、后台商品管理与图片管理

- 功能编号：T002（大任务）
- 目标：完成第一条真实业务闭环——管理员登录 → 上传图片 → 创建商品与设置库存 → 上架 → 小程序查看商品列表和详情。
- 主领域：商品目录 Catalog；协作领域：IdentityAccess（后台身份权限）、Inventory（整件库存）、Audit（操作日志）。
- 负责 Agent：当前主 Agent。
- 授权：用户已授权 T002 全部范围（身份、商品、库存、图片、小程序展示）；拼单交易、支付、履约、客服、工单仍属后续任务。
- 修改范围：`backend/src/contexts/{identity-access,catalog,inventory,audit}`、`backend/src/workflows`、`backend/src/bootstrap`、`backend/migrations`、`contracts`、`apps/admin-web`、`apps/mini-program`、`compose.yaml`、`scripts`、`tests`、相关文档。
- 前置功能：[T001 框架与 Docker 基础](../T001-platform-foundation/README.md)。
- 当前状态：已完成（T002 范围内能力落地并通过专项/全量/冒烟与实操验收；见 verification.md）。
- 阻塞项：无阻塞性业务歧义。份额支付报价的尾差规则、拼单组匹配等明确划出本任务范围（见 spec 非目标）。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[实际验收](verification.md)。

## 子功能索引

| 编号 | 名称 | 主领域 | 状态 |
| --- | --- | --- | --- |
| [F005](../../features/F005-admin-auth/README.md) | 最小后台身份与权限闭环 | IdentityAccess | 已完成 |
| [F006](../../features/F006-media-assets/README.md) | 商品图片资源管理 | Catalog（媒体资产） | 已完成 |
| [F007](../../features/F007-product-inventory-admin/README.md) | 后台商品与库存管理 | Catalog + Inventory | 已完成 |
| [F008](../../features/F008-mini-catalog/README.md) | 小程序商品列表与详情 | Catalog（用户端投影） | 已完成（开发者工具/真机待用户环境验证） |

依赖顺序：F005 → F006 → F007 → F008 → 整体联调。

## 运维说明（随实现更新）

数据库迁移、初始管理员创建、备份恢复的实际命令在本节和根 README 维护；验收记录在 [verification.md](verification.md)。

- 迁移执行方式：API 容器启动前自动执行 `node backend/dist/bootstrap/migrate.js`（带 advisory lock 与 `schema_migrations` 记录表）；本机执行 `npm run migrate`。
- 初始管理员创建：`npm run admin:init`（读取 `.env` 中 `ADMIN_INITIAL_USERNAME` / `ADMIN_INITIAL_PASSWORD`，幂等更新，凭据不进入源码、镜像和日志）。
- 备份：
  - 数据库：`docker compose exec postgres pg_dump -U pindian pindian > backup/pindian-$(date +%F).sql`
  - 图片卷：`docker run --rm -v pindian-platform_media-data:/data -v "$PWD/backup:/backup" alpine tar czf /backup/media-$(date +%F).tgz -C /data .`
- 恢复：
  - 数据库：`cat backup/pindian-YYYY-MM-DD.sql | docker compose exec -T postgres psql -U pindian pindian`
  - 图片卷：先清空卷目录再解包同名 tgz；恢复后需确认 `media_assets` 表记录与文件一一对应。
