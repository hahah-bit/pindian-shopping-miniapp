# F009 spec

上游：[T003 spec](../../tasks/T003-user-identity-address/spec.md) §2（决策 1–3、8）、§3（auth 契约）、§6（G1–G8、G18）。本文件细化验收条件。

## 接口契约细节

- `POST /api/mini/v1/auth/login`：body `{code: string(1..256)}`；200 `{token, expiresAt, isNewUser, user: {id, nickname, hasPhone, phoneMasked, status, createdAt}}`；错误：400 `VALIDATION_FAILED`（code 缺失）、401 `WECHAT_CODE_INVALID`、403 `USER_DISABLED`、502 `WECHAT_UNAVAILABLE`、503 `WECHAT_NOT_CONFIGURED`。
- `GET /api/mini/v1/auth/me`：user realm；200 `{id, nickname, hasPhone, phoneMasked, phoneVerified, status, createdAt}`；401 未认证。
- `POST /api/mini/v1/auth/logout`：user realm；幂等 200 `{revoked: true}`；401 仍要求有效 token（无效 token 的"登出"直接 401，前端清本地态即可）。
- token 格式与 admin 一致（base64url 43 字符），但签发到 `user_sessions` 表；错误响应不区分"token 过期/无效"细节（统一 `UNAUTHENTICATED`）。

## 行为规则

1. 登录流程：code 必填非空 → `WxAuthPort.exchangeCodeForSession` → 身份查找/创建（事务）→ 签发会话 → 返回。微信调用在事务外。
2. 未配置凭据（`WX_APPID`/`WX_APP_SECRET` 任一缺失）：登录直接 503 `WECHAT_NOT_CONFIGURED`（"微信登录暂未配置，请联系管理员"），不发起外部调用、不产生任何数据。
3. 微信错误映射：40029→401 `WECHAT_CODE_INVALID`（"登录凭证无效，请重试"）；40226→403 `WECHAT_RISK_BLOCKED`；-1/45011/超时/5xx→502 `WECHAT_UNAVAILABLE`。
4. 禁用用户：登录 403 `USER_DISABLED`；既有会话认证 401（禁用操作撤销全部会话，属 F012）。
5. 小程序 `platform/user-auth.ts`：`ensureLogin()`（有 token 先 me 校验，401 或无 token → wx.login+POST login，存 storage）；`authedGet/Post/Patch/Put/Delete` 封装（自动带 Bearer，401 清态并抛特定错误供页面回到未登录态）；失败 toast 明确区分"微信未配置/凭证无效/网络错误"。
6. 登录限流：不做（code 一次性本身防重放；微信侧有 45011 频控；本地无凭据环境无攻击面）。

## 验收条件

- AC-F09-1 G2/G3：首次建户 isNewUser=true；重复登录同 userId isNewUser=false（单测+集成）。
- AC-F09-2 G4：并发同 openid 首次登录仅建一个用户，两次登录最终同 userId（集成并发）。
- AC-F09-3 G5：无效 code（fake 端口抛 40029）→ 401，无会话产生。
- AC-F09-4 G6：未配置凭据 → 503 `WECHAT_NOT_CONFIGURED`，无外部调用、无数据写入。
- AC-F09-5 会话：签发后 me 可用；过期（TTL 冻结时钟）401；logout 后旧 token 401；logout 幂等。
- AC-F09-6 admin token 访问 user 接口（及反向）401 `UNAUTHENTICATED`（realm 隔离）。
- AC-F09-7 G19：重启（重建容器不删卷）后会话与用户保留。
- AC-F09-8 小程序：未登录态/登录按钮/过期重登/失败提示可用（模拟器验证受限于微信环境，接口层由集成覆盖，页面冒烟记录于 verification）。
