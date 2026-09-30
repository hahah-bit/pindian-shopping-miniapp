# F012 spec

上游：[T003 spec](../../tasks/T003-user-identity-address/spec.md) §2（决策 7、8）、§3（契约）、§5（后台页面）、§6（G15–G18）。本文件细化验收条件。

## 接口契约细节

- `GET /api/admin/v1/users?keyword&status&page&pageSize`：admin realm + `user:manage`；200 分页 `{items: AdminUserListItem[], page, pageSize, total}`；keyword 按昵称 ILIKE；status ∈ active|disabled。列表项：`{id, nickname, hasPhone, phoneMasked, status, createdAt, lastLoginAt}`。
- `GET /api/admin/v1/users/:id`：同权限；200 同构详情；404 不存在。
- `GET /api/admin/v1/users/:id/phone`：同权限；200 `{phone, countryCode}`；404；**强制审计**。
- `POST /api/admin/v1/users/:id/disable` · `/enable`：同权限；幂等 200 详情视图；404；disable 审计 `user.disabled`（detail 含 reason? 不强制原因，MVP 略）。
- 手机号脱敏规则：11 位大陆号码 `138****1234`；其他/异常格式统一 `****` 尾 4 位（有号码但格式异常时不暴露原文）。

## 行为规则

1. 服务端权限检查：`user:manage` 缺失 403（前端隐藏按钮不是防线）。
2. 不提供修改用户身份/验证事实/昵称的接口——管理员只能看和禁用/启用。
3. 禁用后果：既有会话立即失效（同事务撤销）；登录 403 `USER_DISABLED`；启用后可重新登录，原 token 不恢复（需重新登录）。
4. 审计：phone_revealed/disabled/enabled 均记录 adminId、resourceType=user、resourceId、requestId；审计内容不含手机号原文（避免日志二次泄露）。

## 验收条件

- AC-F12-1 列表分页/筛选正确；响应手机号全部脱敏（G17）。
- AC-F12-2 详情同构；不存在 404。
- AC-F12-3 reveal 返回原文且审计落库（G16）；审计记录不含手机号原文。
- AC-F12-4 无 `user:manage` 权限 403（G15）——以守卫单测覆盖（当前仅 super_admin，403 路径用权限集模拟验证）。
- AC-F12-5 禁用：状态 disabled + 全部会话失效（旧 token 401 `USER_DISABLED`）+ 登录 403（G18）；启用后可登录；操作幂等。
- AC-F12-6 后台页面：列表/详情/查看手机号（确认框说明审计）/禁用启用（确认框说明后果）可用；浏览器实操记录。
