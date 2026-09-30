# F006 商品图片资源管理

- 功能编号：F006
- 目标：真实图片上传、元数据管理、本地文件存储（Docker 命名卷）与公开读取；商品通过图片 ID 关联主图/详情图。
- 主领域：Catalog（媒体资产聚合）；协作领域：IdentityAccess（上传权限）、Audit（操作日志）。
- 负责 Agent：当前主 Agent。
- 所属大任务：[T002](../../tasks/T002-catalog-admin-media/README.md)；整体设计见 [T002 ddd](../../tasks/T002-catalog-admin-media/ddd.md)、[T002 spec](../../tasks/T002-catalog-admin-media/spec.md)。
- 修改目录：`backend/src/contexts/catalog`（media 部分）、`backend/migrations/0003*`、`compose.yaml`、`backend/Dockerfile`、`contracts`、`apps/admin-web`（上传组件/图片库）、`tests/task-suites/t002`。
- 前置功能：[F005](../F005-admin-auth/README.md)。
- 当前状态：已完成（TDD + 集成 + 卷持久化验证；见 verification.md）。
- 阻塞项：无。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-09-30：完成实现与验收（校验矩阵/补偿/引用约束 TDD、集成与实操通过）。
