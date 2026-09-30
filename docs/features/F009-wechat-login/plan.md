# F009 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[T003 plan](../../tasks/T003-user-identity-address/plan.md) S1/S2。

## 测试策略

采用 TDD：登录关联/并发/会话生命周期/域隔离是安全规则（AGENTS 2.2.1）。测试文件 `tests/task-suites/t003/user-auth.test.mjs`（纯内存仓储 + FakeWxAuthPort + 冻结时钟，先红后绿）；HTTP/PG 集成进 `tests/task-suites/t003/integration-db-http.test.mjs`（测试装配注入 fake 端口）。通过标准：单测全绿 + 集成断言通过。

## 步骤

- [ ] P1 迁移 0006（users + user_wechat_identities，openid 唯一）与 0007（user_sessions，token_hash 唯一）。
- [ ] P2 contracts：MiniUserView/LoginResponse/UserProfileUpdateRequest + OpenAPI。
- [ ] P3 TDD 领域+应用：User/WechatIdentity/UserSession 工厂与不变量；LoginWithWechat（未配置/无效 code/微信失败/禁用/首次/重复/唯一冲突回读）、AuthenticateUser（过期/撤销/禁用/realm）、LogoutUser（幂等）。测试先行。
- [ ] P4 适配器：pg 三仓储；WxHttpAuthAdapter（fetch code2Session；未配置状态；错误映射）；守卫 realm 分派改造（admin 默认拒绝不变）。
- [ ] P5 入口：MiniAuthController（login public、me/logout user realm）；装配（fake 仅测试模块）。
- [ ] P6 小程序：`platform/user-auth.ts`（ensureLogin/认证请求封装/401 处理）；profile 页未登录态与登录按钮。
- [ ] P7 验证：单测证据 → 集成（含并发首次登录、realm 隔离、重启保留）→ 浏览器/工具冒烟；回写 verification.md。

## 完成标准

spec AC-F09-1..8 满足；凭据不出现在源码/镜像/日志；T003 plan S2 勾选。
