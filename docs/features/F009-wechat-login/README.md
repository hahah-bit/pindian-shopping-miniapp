# F009 微信登录与用户会话

- 功能编号：F009
- 目标：wx.login code 换取服务端会话；首次建户、重复关联、并发安全；会话生命周期与禁用拦截；小程序登录态封装。
- 主领域：IdentityAccess；协作领域：无（Audit 不记录用户登录）。
- 负责 Agent：当前主 Agent。
- 所属大任务：[T003](../../tasks/T003-user-identity-address/README.md)；领域/会话设计见 [T003 ddd](../../tasks/T003-user-identity-address/ddd.md) §2.2/2.3/§7.1。
- 修改目录：`backend/src/contexts/identity-access`（user 部分）、`backend/src/adapters/outbound/wechat`（新）、`backend/migrations/0006*、0007*`、`contracts`、`apps/mini-program/miniprogram/platform`、`features/profile`、`tests/task-suites/t003`。
- 前置功能：[F005](../F005-admin-auth/README.md)（会话模式与守卫机制）。
- 当前状态：已完成（TDD+集成；真实微信登录未验证，见 verification.md）。
- 阻塞项：2026-10-06 已取得本机测试号凭据并通过官方凭据预检查；有效用户登录流程和安卓真机仍待验证，见最新 verification，不代表渠道整体验收完成。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-09-30：完成实现与验收。
