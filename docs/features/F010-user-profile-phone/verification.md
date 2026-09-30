# F010 实际验收记录

日期：2026-09-30。结论：本地与集成层验收通过；真实手机号组件未执行（需认证主体+付费，见 T003 README 核验记录）。

## 测试证据

| 验证 | 操作 | 结果 |
| --- | --- | --- |
| TDD | user-auth.test.mjs（BindPhone/UpdateProfile 部分） | 绑定写入验证事实（phone/phoneVerifiedAt/phoneSource）、换绑覆盖、openid 绑定校验（他人 code 400"凭证与当前用户不匹配"）、微信失败不写任何字段（G14）、昵称 trim 合法更新/空与超长 400 |
| 集成 | t003/integration | 绑定 200（phoneMasked=138****1234）、无效 code 400 `PHONE_CODE_INVALID` 且 me 视图保持原号码、昵称 PATCH 200/400 |
| 适配器 | HttpWxAccessTokenAdapter（stable_token 缓存+提前刷新）+ HttpWxPhoneAdapter | 假微信端点全 HTTP 路径验证；未配置 503 |
| 页面 | profile 页绑定按钮（open-type=getPhoneNumber）/拒绝授权提示/昵称编辑 | 类型检查通过；真实弹窗待微信环境（如实记录） |

## 未验证

真实 getuserphonenumber 调用、真实授权弹窗与拒绝授权（组件需认证主体）、真实计费。
