# F010 用户资料与手机号绑定

- 功能编号：F010
- 目标：昵称修改；手机号仅经微信验证事实绑定（服务端 code 换取）；拒绝授权/失败有明确反馈。
- 主领域：IdentityAccess。
- 负责 Agent：当前主 Agent。
- 所属大任务：[T003](../../tasks/T003-user-identity-address/README.md)；设计见 [T003 ddd](../../tasks/T003-user-identity-address/ddd.md) §2.1、§3。
- 修改目录：`backend/src/contexts/identity-access`、`backend/src/adapters/outbound/wechat`（phone 适配器）、`contracts`、`apps/mini-program/miniprogram/features/profile`、`tests/task-suites/t003`。
- 前置功能：[F009](../F009-wechat-login/README.md)。
- 当前状态：已完成（TDD+集成；真实组件未验证，见 verification.md）。
- 阻塞项：手机号组件需认证主体（真实验证缺失，见 T003 README 核验记录）。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-09-30：完成实现与验收。
