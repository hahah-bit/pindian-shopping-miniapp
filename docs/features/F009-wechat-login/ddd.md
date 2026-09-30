# F009 DDD

复用 [T003 ddd](../../tasks/T003-user-identity-address/ddd.md) §2.1/2.2/2.3（User/WechatIdentity/UserSession 不变量）、§3（微信端口）、§4（认证域）、§5（类图）、§6（状态图）、§7.1（登录时序）。本文件仅补充子功能细节，无超出大任务的领域变更。

## 实体细节

- User 创建：`User.create({ nickname: '微信用户', status: 'active' })`；`recordLogin(now)` 返回新实例；`disable(now)/enable(now)` 状态迁移。
- WechatIdentity 绑定发生在登录事务内：身份不存在 → 建 User + 绑定；存在 → 读关联 User。**openid 唯一约束是并发首次登录的最终防线**；应用层先查后插，冲突时回读。
- UserSession 与 AdminSession 同构（token 生成/哈希复用 `TokenService`），独立表独立 realm。
- 登录用例不存储 session_key（无解密需求，减少敏感数据面）。

## 端口

`UserRepository`（findById/findByIdIfActive/save）、`WechatIdentityRepository`（findByOpenid/insert/findByUserId）、`UserSessionRepository`（save/findByTokenHash/revoke/revokeAllForUser/deleteExpired）、`WxAuthPort`、`Clock`、复用 `AdminTokenService`（改名共享 `SessionTokenService` 语义）。

## 事务边界

登录事务：identity 查询 + user 创建/更新 + 会话签发在同一数据库事务（advisory lock 不需要，openid 唯一约束即可）；微信 HTTP 调用在事务外（不把外部调用放持锁事务内）。

## 不做的建模

不做用户角色/积分/会员；不做 unionid 合并；不做 session_key 存储。
