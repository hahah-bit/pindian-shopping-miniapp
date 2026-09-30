# T003 实施计划

依据：[spec](spec.md)、[DDD](ddd.md)。先 spec 后本计划；按依赖顺序实施，每步更新勾选。

## 测试策略（按 AGENTS 2.2 判断）

| 子功能 | 策略 | 理由与验证范围 |
| --- | --- | --- |
| F009 微信登录与用户会话 | TDD | 并发首次登录、会话生命周期、禁用是可自动验证的安全规则 |
| F010 手机号与资料 | TDD | 验证事实驱动、失败不标记绑定是核心业务规则 |
| F011 收货地址 | TDD | 归属、默认唯一并发、上限、校验是核心约束 |
| F012 后台用户管理 | TDD | 权限、脱敏、审计、禁用是安全规则 |
| 小程序/后台页面 | 非 TDD | 布局与交互为主；真实联调冒烟 + 浏览器/工具验证 |

TDD 执行方式沿用 T002：测试先写入 `tests/task-suites/t003/`，运行确认失败（模块缺失/断言失败），再实现转绿；证据记录于 verification.md。

- 专项入口 `npm run test:task:t003`：单测（纯内存/假 WX 端口）+ 集成（真实 PG + 真实 HTTP + **测试装配注入假微信端口**——仅测试模块可注入，生产装配不可切换；同时用真实 main.js 验证无凭据时 `WECHAT_NOT_CONFIGURED` 明确路径）。数据库不可达时集成明确 skip。
- 全量 `npm test`；联调 `npm run docker:up` + 冒烟 + T002 回归（admin 登录/商品/图片/mini 商品）。
- 微信真实环境：无 AppID/AppSecret/认证主体，真登录与真手机号不可验证 → 如实记录（AC02/AC10）。

## 步骤

- [ ] S1 契约与基础设施：contracts 新增类型 + OpenAPI；迁移 0006/0007/0008；config 新增 `USER_SESSION_TTL_MINUTES`、`WX_APPID`、`WX_APP_SECRET`（.env.example 同步，值留空）；守卫改造为 realm 分派（admin 默认拒绝不变）；新增权限点 `user:manage`；WX 端口与 HTTP 适配器（未配置状态）。覆盖 AC07 前置。
- [ ] S2 F009（TDD）：User/WechatIdentity/UserSession 领域 + LoginWithWechat/LogoutUser/AuthenticateUser 用例（fake 端口先红后绿）→ pg 仓储 → MiniAuthController → 小程序 `platform/user-auth.ts`（登录/存储/401 处理）+ profile 页未登录态。覆盖 AC01/AC02。
- [ ] S3 F011（TDD，与 S3 并行授权）：Address 领域 + 用例（归属/上限/默认并发）→ pg 仓储（行锁+部分唯一索引）→ AddressesController → 小程序地址列表/表单页。覆盖 AC04。
- [ ] S4 F010（TDD）：BindPhone（WxPhonePort 假件）/UpdateProfile 用例 → 控制器 → profile 页绑定/改昵称交互。覆盖 AC03。
- [ ] S5 F012（TDD）：AdminUsers 查询（脱敏）/RevealPhone（审计）/Disable·Enable（撤销会话）→ 控制器 → 后台用户管理页。覆盖 AC05。
- [ ] S6 集成测试：tests/task-suites/t003/integration（测试装配 fake WX + 真实 PG + HTTP 全流程 G2–G19 可自动化项；真实 main 无凭据路径单测覆盖）。覆盖 AC01/03/04/05 自动化部分。
- [ ] S7 联调与回归：`docker compose up -d --build`（迁移自动执行、旧数据保留）→ 后台浏览器实操（用户列表/脱敏/审计/禁用）→ T002 回归（admin 登录、商品、图片、mini 商品接口）→ 无凭据登录路径验证 → 冒烟。覆盖 AC08/AC09。
- [ ] S8 专项 → 全量：`npm run test:task:t003` 通过后 `npm test`、`npm run smoke:docker`；失败修复后按专项→全量重验。覆盖 AC09。
- [ ] S9 回写：verification（T003 + F009–F012）、README/architecture/AGENTS 状态、交付总结（含未验证项：微信真实登录/真机）。覆盖 AC10。

## 完成标准

spec AC01–AC10 满足并在 verification.md 有实际执行证据；微信真实环境缺失如实记录，不标记完整验收。
