# F012 DDD

复用 [T003 ddd](../../tasks/T003-user-identity-address/ddd.md) §2.1（User/status）、§6（状态图）、[T002 audit](../../tasks/T002-catalog-admin-media/ddd.md) §2.5（OperationLog）。补充细节，无超出大任务的领域变更。

## 查询投影与权限点

- 新权限点 `user:manage`，加入 `super_admin` 权限集；`RequirePermissions('user:manage')` 标注路由；无权限 403（守卫既有机制）。
- 列表/详情投影：`{id, nickname, hasPhone, phoneMasked, status, createdAt, lastLoginAt}`（不返回 phone 原文、不返回微信 openid——openid 属内部身份标识，非运营必要数据）。
- RevealPhone：单独端点返回 `{phone, countryCode}`，必须写审计 `user.phone_revealed`（detail 含 userId、requestId），审计失败不阻断返回（与既有 RecordOperation 一致，记录服务端告警）。
- 禁用/启用：`User.disable/enable` 状态迁移；禁用同时撤销该用户全部 UserSession（同事务）；写审计 `user.disabled`/`user.enabled`。

## 端口

复用 `UserRepository`（新增 `listUsers({keyword, status, page, pageSize})`、`updateStatus`）、`UserSessionRepository.revokeAllForUser`、`RecordOperation`。

## 事务边界

禁用：状态更新 + 撤销会话同一事务（保证"禁用即失效"不被窗口绕过）；启用单行。

## 不做的建模

不提供编辑昵称/手机号/微信身份的后台接口（身份与验证事实不可篡改）；不做后台查询地址簿；不做用户删除。
