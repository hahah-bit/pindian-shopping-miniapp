# T003 用户身份、收货地址与后台用户管理

- 功能编号：T003（大任务）
- 目标：小程序真实微信登录与会话、用户资料与手机号绑定、收货地址管理；后台按权限查询用户与必要资料（脱敏+审计）；为拼单下单提供可靠身份与地址基础。
- 主领域：IdentityAccess；协作领域：Audit（敏感资料查看与状态操作审计）。
- 负责 Agent：当前主 Agent。
- 授权：用户已授权 T003 全部范围（微信登录、手机号、地址、后台用户管理）。
- 修改范围：`backend/src/contexts/identity-access`、`adapters-shared`、`bootstrap`、`backend/migrations/0006..0008`、`contracts`、`apps/mini-program`（profile/auth/address）、`apps/admin-web`（用户管理）、`tests`、相关文档。
- 前置功能：[T002](../T002-catalog-admin-media/README.md)（已完成并通过自验：专项 48/48、全量 56/56、冒烟与浏览器实操；docs/coordination 无待处理审查反馈）。
- 当前状态：已完成（本地与集成层验收通过；真实微信登录/真机未验证，见 verification.md）。
- 阻塞项：**真实微信凭据缺失**（无 AppID/AppSecret、无认证主体）→ 微信登录/手机号真实验证不可执行；采用端口抽象+明确定义"未配置"行为，不伪造成功。代码与本地验证不受阻塞。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[实际验收](verification.md)。

## 子功能索引

| 编号 | 名称 | 主领域 | 状态 |
| --- | --- | --- | --- |
| [F009](../../features/F009-wechat-login/README.md) | 微信登录与用户会话 | IdentityAccess | 已完成 |
| [F010](../../features/F010-user-profile-phone/README.md) | 用户资料与手机号绑定 | IdentityAccess | 已完成 |
| [F011](../../features/F011-user-addresses/README.md) | 收货地址管理 | IdentityAccess | 已完成 |
| [F012](../../features/F012-admin-users/README.md) | 后台用户管理 | IdentityAccess + Audit | 已完成 |

依赖顺序：F009 → F010 / F011（可并行）→ F012 → 整体联调。

## 外部接口核验记录（2026-09-30，微信官方文档）

| 能力 | 接口 | 关键约束 |
| --- | --- | --- |
| 登录凭证校验 | GET `https://api.weixin.qq.com/sns/jscode2session`（appid/secret/js_code/grant_type=authorization_code） | 仅服务端调用；返回 openid/unionid/session_key；错误码 -1、40029（code 无效）、40226（风险拦截）、45011（频率）；session_key 本任务不解密不存储 |
| 接口调用凭据 | POST `/cgi-bin/stable_token`（与旧 `/cgi-bin/token` 相互隔离），有效期 7200s | 服务端缓存，过期前刷新 |
| 获取手机号 | POST `/wxa/business/getuserphonenumber?access_token=…`，body `{code}`（可选 openid 校验绑定关系） | code 一次性、5 分钟有效；返回 phoneInfo{phoneNumber,purePhoneNumber,countryCode,watermark}；错误码 -1、40013、40029、45011 |
| 手机号组件资格 | 手机号快速验证组件 | **要求非个人主体且已微信认证；2023-08-28 起付费 0.03 元/次，每账号 1000 次免费额度**。当前项目无认证主体 → 真实调用不可执行，见 spec"未配置"行为 |
| 头像昵称 | `wx.getUserProfile` 已回收（返回匿名"微信用户"/灰头像）；官方替代为头像昵称填写能力（button open-type=chooseAvatar + input type=nickname） | 展示资料不作为可信身份；本阶段仅实现昵称（用户自填），头像文件上传不做（见 spec 决策） |

来源：developers.weixin.qq.com 官方文档（code2Session、getAccessToken/stable_token、phone-number、api_getphonenumber 各页），核验日期 2026-09-30。
