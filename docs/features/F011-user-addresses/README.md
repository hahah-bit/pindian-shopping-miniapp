# F011 收货地址管理

- 功能编号：F011
- 目标：地址列表/新增/编辑/删除/设默认；归属强制；默认唯一（并发安全）；上限 20。
- 主领域：IdentityAccess。
- 负责 Agent：当前主 Agent。
- 所属大任务：[T003](../../tasks/T003-user-identity-address/README.md)；设计见 [T003 ddd](../../tasks/T003-user-identity-address/ddd.md) §2.4、§7.2。
- 修改目录：`backend/src/contexts/identity-access`、`backend/migrations/0008*`、`contracts`、`apps/mini-program/miniprogram/features/address`、`tests/task-suites/t003`。
- 前置功能：[F009](../F009-wechat-login/README.md)（用户会话）。
- 当前状态：已完成（TDD+集成+并发默认修复）。
- 阻塞项：无。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-09-30：完成实现与验收。
