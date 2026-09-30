# F005 spec

上游：[T002 spec](../../tasks/T002-catalog-admin-media/spec.md) §2（决策 1–3）、§3.1、§4（auth 契约）。本文件细化验收条件；规则冲突以上游为准。

## 接口契约细节

- `POST /api/admin/v1/auth/login`：body `{username, password}`（字符串，1..128 字符）。成功 200 `{token, expiresAt, admin: {id, username, displayName, role, permissions: string[]}}`。失败 401 `UNAUTHENTICATED`（统一话术“用户名或密码不正确”）；限流中 429 `RATE_LIMITED`（提示剩余等待分钟）。
- `POST /api/admin/v1/auth/logout`：Bearer。成功 200 `{revoked: true}`；token 已失效仍返回 200（幂等，不泄露会话状态）；无/坏 token 401。
- `GET /api/admin/v1/auth/me`：Bearer。成功 200 返回 admin 资料（同登录响应的 admin 字段）+ `permissions`；失效 401。
- 守卫：所有 `/api/admin/v1/*` 除 login 外必须 Bearer 认证；权限码注解缺失默认拒绝（白名单显式声明）。
- 错误响应不含密码哈希、用户列表差异、堆栈；requestId 贯穿。

## 会话与凭据规则

1. token 仅登录响应出现一次；任何接口不回显 token。
2. 会话 TTL 绝对 12h（可配），无滑动续期；过期后须重新登录。
3. 密码存储 scrypt（随机盐，格式 `scrypt$N$r$p$salt$hash`）；校验用 `timingSafeEqual`。
4. 初始管理员：`ADMIN_INITIAL_USERNAME`（3..32，`^[a-z0-9_-]+$`）+ `ADMIN_INITIAL_PASSWORD`（≥10 字符）。命令幂等：已存在同名管理员 → 更新密码哈希、置 active 并撤销其全部会话；输出不含密码。参数缺失/非法 → 非零退出码与明确错误，不落库。
5. 登录限流：同用户名失败 5 次 → 锁 15 分钟（含成功后重置）；计数在内存（单实例边界记录于架构文档）。
6. 登录成功/失败、初始管理员创建均写 OperationLog（action：`admin.login`、`admin.login_failed`、`admin.initial_created`）。

## 前端行为

- 登录页：空值/长度即时校验；提交中禁用；401/429/网络错误分别提示；成功后 token 存 `sessionStorage`（关闭标签即清）并跳转框架概览。
- 应用启动：有 token → `/auth/me` 验证；401 → 清 token 进登录页；网络错误 → 提示重试。
- 登出：调用接口后清 token 回登录页（接口失败也本地清除，界面不卡死）。
- 所有后台请求自动附带 Bearer；不再在任何位置硬编码 token/密码。

## 验收条件

- AC-F05-1 G 无 token，W 调用 admin 写接口（media/products/stock），T 401 且无任何数据变更（集成验证）。
- AC-F05-2 错误密码 5 次后第 6 次（即使密码正确）→ 429；15 分钟窗口逻辑以单测冻结时钟验证。
- AC-F05-3 登出后原 token 调用受保护接口 → 401。
- AC-F05-4 过期会话认证失败（TTL=0 冻结时钟单测）。
- AC-F05-5 disabled 管理员既有会话认证失败。
- AC-F05-6 初始管理员脚本：创建成功可登录；重复执行改密码后旧密码失效、新密码可登录；无凭据输出。
- AC-F05-7 权限判定纯函数：super_admin 拥有全部权限码；未知角色无权限。
- AC-F05-8 后台登录/登出/会话恢复实操可用（浏览器验证）。
- AC-F05-9 scrypt 哈希可验证：正确密码通过、错误密码拒绝、相同密码不同盐哈希不同。
