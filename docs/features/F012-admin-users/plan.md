# F012 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[T003 plan](../../tasks/T003-user-identity-address/plan.md) S5。

## 测试策略

采用 TDD：脱敏、审计、禁用撤销会话、权限是安全规则（AGENTS 2.2.1）。测试并入 `tests/task-suites/t003/admin-users.test.mjs`（内存仓储 + 假审计仓储先红后绿）；HTTP/PG 集成进 t003 集成测试。页面非 TDD，浏览器冒烟。

## 步骤

- [ ] P1 contracts：AdminUserListItem/AdminUserView/AdminPhoneReveal + OpenAPI；权限点 `user:manage` 加入 AdminPermission。
- [ ] P2 TDD 应用：ListAdminUsers（分页筛选/脱敏规则）、GetAdminUser、RevealUserPhone（审计写入、审计不含原文）、DisableUser（状态+撤销会话同事务）/EnableUser（幂等）。测试先行。
- [ ] P3 适配器：UserRepository 扩展（listUsers/updateStatus）；UserSessionRepository 复用 revokeAllForUser。
- [ ] P4 入口：AdminUsersController（user:manage 权限标注）；装配。
- [ ] P5 后台页面：导航"用户管理"（#/users）：列表/筛选/分页、详情抽屉、查看手机号确认框、禁用/启用确认框与后果说明。
- [ ] P6 验证：单测证据 → 集成（脱敏/审计/禁用会话失效）→ 浏览器实操；回写 verification.md。

## 完成标准

spec AC-F12-1..6 满足；用户敏感资料不泄露到无审计路径；T003 plan S5 勾选。
