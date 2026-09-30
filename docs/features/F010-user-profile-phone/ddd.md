# F010 DDD

复用 [T003 ddd](../../tasks/T003-user-identity-address/ddd.md) §2.1（User 不变量：phone 必须伴随验证事实）、§3（WxPhonePort/WxAccessTokenPort）。补充细节，无超出大任务的领域变更。

## 模型细节

- 绑定 = 验证事实写入：`User.bindPhone(purePhoneNumber, countryCode, source, verifiedAt)` 返回新实例；仅当 `phoneSource='wechat_quick_verify'` 时才允许设置 `phoneVerifiedAt`；客户端提交号码无对应入口。
- 换绑：再次授权验证覆盖旧号码（更新 phone/phoneVerifiedAt/来源时间）；解绑不做（无业务需求，绑定事实保留）。
- 昵称：`User.rename(nickname)` 校验 1–30 字符（trim 后非空）。
- WxPhonePort 调用链：`WxAccessTokenPort.getToken()`（stable_token 缓存 7200s，提前 5 分钟刷新）→ POST getuserphonenumber body `{code, openid}`（带 openid 校验 code 与用户的绑定关系，防跨用户使用 code）。

## 端口

`WxAccessTokenPort`（HttpWxAccessTokenAdapter：读 WX_APPID/WX_APP_SECRET，未配置同样进入 NOT_CONFIGURED）、`WxPhonePort`（HttpWxPhoneAdapter）、`UserRepository`、`Clock`。

## 事务边界

单聚合单行更新（用户 phone 字段），无跨聚合事务；微信 HTTP 调用在事务外。

## 不做的建模

不做短信验证码备用通道（个人主体替代方案，留待后续决策）；不做手机号唯一约束；不记录用户侧操作日志。
