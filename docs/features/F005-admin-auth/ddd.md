# F005 DDD

复用 [T002 ddd](../../tasks/T002-catalog-admin-media/ddd.md) §2.1（Admin/AdminSession 不变量）、§2.5（OperationLog）、§5（类图）、§6.1（登录时序）。本文件补充本子功能的模型细节，无领域变更超出大任务设计。

## 统一语言补充

- 登录 = 校验凭据并签发会话；认证 = 每个受保护请求用 Bearer token 换取管理员身份与权限；撤销 = 登出或过期后 token 立即失效。
- 权限码：`catalog:manage`、`inventory:manage`、`media:manage`、`admin:manage`。角色 `super_admin` 拥有全部权限码；权限判定是领域纯函数 `can(role, permission)`。

## 实体细节

- `Admin.status ∈ {active, disabled}`：disabled 拒绝登录且既有会话认证失败（认证时回查管理员状态）。
- `AdminSession.expiresAt = 签发时间 + ADMIN_SESSION_TTL_MINUTES`；认证时同时校验 `revokedAt == null` 与 `expiresAt > now`；登出设置 `revokedAt`。过期会话由登录触发的惰性清理删除（不引入定时任务）。
- token 生成：32 字节随机 → base64url（43 字符）；落库仅 sha256 哈希；认证按哈希查会话。不使用 JWT（可撤销优先于无状态）。

## 端口

`AdminRepository`（按用户名/ID 查、保存、更新最后登录）、`SessionRepository`（保存/按哈希查/撤销/清理过期）、`PasswordHasher`（hash/verify，scrypt 适配器）、`TokenGenerator`（随机 token，crypto 适配器）、`OperationLogRepository`、`Clock`。仓储实现全部位于 `adapters/outbound/postgres`；crypto 实现位于 `adapters/outbound/crypto`。

## 事务边界

登录涉及“校验 + 签发会话 + 记录 lastLoginAt”：单条会话插入与单字段更新，无需跨聚合事务；失败路径无部分写入（先校验后写）。初始管理员创建为单行 upsert（存在即更新密码/启用），依赖 `username` 唯一约束兜底并发。

## 不做的建模

不建角色表/权限表/组织表（后续身份任务扩展）；不做记住我/多端踢出/密码找回（超范围）。
