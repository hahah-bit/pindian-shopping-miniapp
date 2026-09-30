# F012 后台用户管理

- 功能编号：F012
- 目标：用户列表/详情（脱敏）、完整手机号查看（强制审计）、禁用/启用（撤销会话）、服务端权限检查。
- 主领域：IdentityAccess；协作领域：Audit（敏感操作记录）。
- 负责 Agent：当前主 Agent。
- 所属大任务：[T003](../../tasks/T003-user-identity-address/README.md)；设计见 [T003 ddd](../../tasks/T003-user-identity-address/ddd.md) §6、[T003 spec](../../tasks/T003-user-identity-address/spec.md) §2 决策 7。
- 修改目录：`backend/src/contexts/identity-access`、`contracts`、`apps/admin-web/src/features/admin-users`、`tests/task-suites/t003`。
- 前置功能：[F009](../F009-wechat-login/README.md)（用户数据）、[F005](../F005-admin-auth/README.md)（权限机制）。
- 当前状态：已完成（TDD+集成+浏览器实操）。
- 阻塞项：无。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-09-30：完成实现与验收。
