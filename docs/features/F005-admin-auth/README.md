# F005 最小后台身份与权限闭环

- 功能编号：F005
- 目标：管理员登录、登出、身份查询与服务端权限校验；安全的初始管理员创建。
- 主领域：IdentityAccess；协作领域：Audit（登录与写操作日志）。
- 负责 Agent：当前主 Agent。
- 所属大任务：[T002](../../tasks/T002-catalog-admin-media/README.md)，整体 DDD/spec 见 [T002 ddd](../../tasks/T002-catalog-admin-media/ddd.md)、[T002 spec](../../tasks/T002-catalog-admin-media/spec.md)。
- 修改目录：`backend/src/contexts/identity-access`、`backend/src/contexts/audit`、`backend/src/bootstrap`、`backend/migrations/0001*、0002*`、`contracts`、`apps/admin-web/src/{platform,features/admin-auth}`、`tests/task-suites/t002`。
- 前置功能：[F002 后端基础](../F002-backend-foundation/README.md)。
- 当前状态：已完成（TDD + 集成 + 浏览器实操；见 verification.md）。
- 阻塞项：无。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## DDD 摘要

复用 T002 DDD 第 2.1/2.5 节：Admin（聚合根）+ AdminSession（实体）+ Permission（值对象）；OperationLog（Audit 实体）。本功能无新增聚合；领域不变量、状态与会话时序见 T002 ddd.md §2.1、§5、§6.1。无独立 UML，引用大任务图。

## 状态记录

- 2026-09-30：完成实现与验收（TDD 11/11、集成与浏览器实操通过）。
