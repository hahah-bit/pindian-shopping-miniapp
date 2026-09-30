# F010 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[T003 plan](../../tasks/T003-user-identity-address/plan.md) S4。

## 测试策略

采用 TDD：验证事实驱动与失败不标记绑定是核心业务规则（AGENTS 2.2.1）。测试并入 `tests/task-suites/t003/user-auth.test.mjs`（bindPhone/rename 用例，FakeWxPhonePort 先红后绿）；HTTP 集成进 t003 集成测试。页面部分（绑定按钮/提示）非 TDD，实现后接口层冒烟。

## 步骤

- [ ] P1 contracts：PhoneBindRequest/ProfileUpdateRequest + OpenAPI。
- [ ] P2 TDD 领域+应用：User.bindPhone/rename；BindPhone 用例（成功/换绑/微信失败/未配置/openid 不匹配）；UpdateProfile 用例（校验）。测试先行。
- [ ] P3 适配器：HttpWxAccessTokenAdapter（stable_token POST + 缓存 + 提前刷新）、HttpWxPhoneAdapter（POST getuserphonenumber + 错误映射）。
- [ ] P4 入口：MiniProfileController（PATCH profile、POST phone，user realm）；装配。
- [ ] P5 小程序：profile 页昵称修改（弹层输入）、绑定按钮（open-type=getPhoneNumber → code → POST；拒绝授权提示；未配置错误展示）、手机号徽标。
- [ ] P6 验证：单测证据 → 集成 → 页面接口冒烟；回写 verification.md（真实组件弹窗未验证项记录）。

## 完成标准

spec AC-F10-1..7 满足；手机号原文不出现在列表/普通视图；T003 plan S4 勾选。
