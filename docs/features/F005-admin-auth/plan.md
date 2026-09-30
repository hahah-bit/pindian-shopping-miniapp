# F005 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[T002 plan](../../tasks/T002-catalog-admin-media/plan.md) S1–S3。

## 测试策略

采用 TDD：会话与权限是可自动验证的安全规则（AGENTS 2.2.1）。先写 `tests/task-suites/t002/auth.test.mjs`（纯内存仓储 + 假哈希器 + 冻结时钟），运行确认失败，再实现。HTTP 层（401/403 路径）由集成测试覆盖（依赖 PG，见 T002 S7）。通过标准：本文件测试全绿 + 集成相关断言通过。

## 步骤

- [ ] P1 迁移 0001（admins/admin_sessions）与 0002（admin_operation_logs）：唯一约束、撤销/过期字段、索引；迁移执行器与 `schema_migrations` 先行（T002 S2 交付）。
- [ ] P2 contracts：AdminProfile/LoginResponse 等 DTO 与 OpenAPI 片段。
- [ ] P3 TDD 领域与应用：`Admin`、`AdminSession`、`can()`；LoginAdmin（限流/统一话术/签发/lastLogin）、LogoutAdmin、AuthenticateAdmin（哈希查会话/过期/撤销/disabled）、CreateOrUpdateInitialAdmin。测试先行。
- [ ] P4 适配器：pg 仓储（会话按 token_hash 唯一）、scrypt PasswordHasher、crypto TokenGenerator、audit OperationLog 用例与 pg 仓储。
- [ ] P5 入口：AuthController（login/logout/me）、AdminAuthGuard + RequirePermissions 装饰器（默认拒绝）、HttpErrorFilter 扩展错误码映射（401/403/429）。
- [ ] P6 create-admin.ts 引导脚本 + npm scripts（migrate/admin:init）+ compose/Dockerfile/env 变更（属 T002 S2，此处联调）。
- [ ] P7 前端：api-client Bearer 封装与错误对象、LoginView、App 启动会话恢复与登出、导航守卫。
- [ ] P8 验证：单测（先失败后通过证据）→ 与 F006/F007 联调时的集成断言 → 浏览器实操；回写 verification.md。

## 完成标准

spec AC-F05-1..9 全部满足；凭据不出现在源码/镜像/日志；T002 plan S3 勾选。
