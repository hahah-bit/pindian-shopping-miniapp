# F012 实际验收记录

日期：2026-09-30。结论：本功能范围内验收通过。

## 测试证据

| 验证 | 操作 | 结果 |
| --- | --- | --- |
| TDD | tests/task-suites/t003/admin-users.test.mjs（先红后绿） | 5/5：列表脱敏（JSON 无原文）+分页+昵称/状态筛选、详情 404、reveal 原文+审计落库且审计不含原文、无手机号 reveal 404、禁用撤销全部会话+幂等+审计链（disabled/disabled/enabled）、脱敏兜底（异常格式不泄露） |
| 集成 | t003/integration | 列表 total=3 且无原文、详情脱敏、reveal 200 原文、审计表 `user.phone_revealed` 存在（连测试库断言）、禁用后会话 401+登录 403 `USER_DISABLED`、启用后重登同一用户 |
| 权限点 | user:manage 加入 ROLE_PERMISSIONS；守卫 RequirePermissions('user:manage') | 无权限 403（集成实测：修权限集前 403、修后 200） |
| 浏览器实操 | #/users：造 2 个验证用户（DB 直插）→ 列表脱敏/徽标/分页 → 详情 → confirm 接受后查看原文（"已记录审计"）→ 审计表 phone_revealed/disabled/enabled 三条含 adminId → 禁用→启用状态机执行 | 通过 |

## 修复记录

- `user:manage` 初期只加 contracts 类型，后端 ROLE_PERMISSIONS 未加 → 后台 403；补齐并在 T002 auth 测试断言中同步（T003 契约演进）。

## 未验证

多角色下的 403（当前仅 super_admin 一种角色数据，权限判定逻辑由 `can()` 单测覆盖）；地址簿后台查询（spec 决策不开放）。
