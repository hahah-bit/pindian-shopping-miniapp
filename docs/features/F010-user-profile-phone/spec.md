# F010 spec

上游：[T003 spec](../../tasks/T003-user-identity-address/spec.md) §2（决策 4–5、8）、§3（契约）、§4（我的页）、§6（G14）。本文件细化验收条件。

## 接口契约细节

- `POST /api/mini/v1/auth/phone`：user realm；body `{code: string(1..256)}`；200 `{hasPhone: true, phoneMasked, phoneVerified: true}`；错误：400 `PHONE_CODE_INVALID`（微信 40013/40029）、400 `VALIDATION_FAILED`（code 缺失）、502 `WECHAT_UNAVAILABLE`、503 `WECHAT_NOT_CONFIGURED`、401 未认证。
- `PATCH /api/mini/v1/auth/profile`：user realm；body `{nickname: string}`；200 返回 me 同构视图；400 校验失败。
- 手机号展示统一脱敏（`138****1234`，非大陆号码显示 `+86 尾四位掩码`）；`me` 返回 `hasPhone/phoneMasked/phoneVerified`，不返回原文。

## 行为规则

1. 绑定仅服务端：小程序 `button open-type="getPhoneNumber"` 回调拿 code → POST auth/phone → 服务端用 access_token 调 getuserphonenumber（带 openid 绑定校验）→ 写入验证事实。
2. 用户拒绝授权（`getPhoneNumber` 回调 errMsg 非 ok）：前端明确提示"未授权手机号"，不发起请求。
3. code 无效/过期（40029）：400 `PHONE_CODE_INVALID`，提示重新点击授权按钮；**不改变任何用户字段**。
4. 未配置凭据：503 `WECHAT_NOT_CONFIGURED`（同登录行为）；不伪造绑定成功。
5. 昵称：trim 后 1–30 字符；默认"微信用户"可改；不含敏感校验（普通展示名）。
6. 头像：本阶段不启用上传（字段预留），页面不提供头像修改入口（避免临时 URL 过期问题）。

## 验收条件

- AC-F10-1 假端口成功验证：绑定后 `hasPhone=true`、`phoneMasked` 正确、`phoneVerifiedAt` 非空（单测+集成）。
- AC-F10-2 微信返回 40029/网络失败：400/502，用户 phone/phoneVerifiedAt 保持为空（G14，单测+集成）。
- AC-F10-3 未配置：503，无字段变更。
- AC-F10-4 换绑：再次验证覆盖旧号码与验证时间。
- AC-F10-5 昵称：合法修改生效；空/超长 400；me 视图同步。
- AC-F10-6 用户 A 的 code 不能为用户 B 绑定（openid 绑定校验，fake 端口模拟不匹配 → 400）。
- AC-F10-7 小程序：绑定按钮拒绝授权有提示；未配置环境显示明确错误（接口层验证，组件真实弹窗依赖微信环境，如实记录）。
