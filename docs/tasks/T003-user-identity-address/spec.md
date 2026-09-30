# T003 功能规范

依据：[需求文档 §3.1/§4](../../requirements/pindian-shopping-mini-program-requirements.md)、[T003 DDD](ddd.md)、[T002 spec](../T002-catalog-admin-media/spec.md)。子功能 spec 引用本文并细化。

## 1. 目标、范围与非目标

**目标**：小程序真实微信登录/会话、资料与手机号绑定、收货地址 CRUD；后台按权限查询用户（脱敏+审计）。为拼单下单提供用户身份与地址基础。

**非目标**：拼单匹配、订单、支付退款、履约、客服、工单、优惠券/会员/分销、头像文件上传、多端身份合并（unionid 全局账号）、后台编辑用户资料。游客浏览商品保持现状（T002 公开接口不变）。

## 2. 已确认决策（来源：用户 T003 授权 + 官方文档核验 + 可逆设计决策）

1. **登录**：`wx.login()` code → 后端 code2Session（服务端）；身份以后端验证为准；首次登录建户、重复登录关联同一用户；openid 唯一约束兜底并发。
2. **会话**：DB 会话 14 天绝对过期（`USER_SESSION_TTL_MINUTES` 可配）；**退出仅撤销当前会话**；过期/被禁用后小程序回到未登录态并可重新登录。
3. **游客能力**：商品浏览不需要登录；地址/资料/手机号操作需要用户会话；不做手机号强制捆绑浏览。
4. **手机号**：仅接受微信手机号组件验证事实（服务端用 code 换取），**不接受客户端直接提交号码**；重新授权验证可更新号码；组件需认证主体+付费（1000 次免费额度），未配置凭据时接口返回 503 `WECHAT_NOT_CONFIGURED`。
5. **资料**：最小资料 = 昵称（用户自填 1–30 字符，默认"微信用户"）+ 手机号（验证后）；头像文件上传本阶段不做（chooseAvatar 返回临时路径需持久化存储，为避免与商品图片公开策略混淆，头像字段预留不启用，记录为后续任务）；展示资料不作为可信身份。
6. **地址**：字段与上限见 DDD §2.4；收货人手机号不强制等于绑定手机号；默认地址唯一（部分唯一索引+行锁）；首次新增不自动默认；删除默认不自动补；物理删除；上限 20 条。
7. **后台**：权限点 `user:manage`；列表/详情默认脱敏（手机号 `138****1234`、昵称原文）；**查看完整手机号需显式请求并强制审计**；不提供编辑用户身份/验证事实的接口；**纳入禁用/启用**（禁用拒绝登录+撤销全部会话，操作留审计）；收货地址本阶段不向后台开放查询（后续履约阶段按需+权限开放）。
8. **错误码新增**：`WECHAT_NOT_CONFIGURED`(503)、`WECHAT_UNAVAILABLE`(502)、`WECHAT_CODE_INVALID`(401)、`WECHAT_RISK_BLOCKED`(403)、`USER_DISABLED`(403)、`PHONE_CODE_INVALID`(400)、`ADDRESS_LIMIT_REACHED`(409)、`NOT_FOUND`(404)、`VALIDATION_FAILED`(400)。

## 3. API 契约（摘要；完整定义见 contracts/openapi.yaml 与 src/index.ts）

通用：包络/错误/时间/分页约定沿用 T002。用户端接口 Bearer 用户 token；`POST /auth/login` 无需认证。

| 方法与路径 | 认证 | 说明 |
| --- | --- | --- |
| POST /api/mini/v1/auth/login `{code}` | 无 | 微信登录 → `{token, expiresAt, isNewUser, user}` |
| GET /api/mini/v1/auth/me | user | 当前用户 `{id, nickname, phoneMasked, phoneVerified, hasPhone, status, createdAt}` |
| POST /api/mini/v1/auth/logout | user | 撤销当前会话（幂等 200） |
| PATCH /api/mini/v1/auth/profile `{nickname}` | user | 修改昵称 |
| POST /api/mini/v1/auth/phone `{code}` | user | 手机号授权 code → 验证绑定 |
| GET /api/mini/v1/addresses | user | 自己的地址列表（默认在前） |
| POST /api/mini/v1/addresses | user | 新增（超 20 条 409） |
| PATCH /api/mini/v1/addresses/:id | user | 编辑（归属校验） |
| DELETE /api/mini/v1/addresses/:id | user | 删除（归属校验） |
| PUT /api/mini/v1/addresses/:id/default | user | 设默认（并发唯一） |
| GET /api/admin/v1/users?keyword&status&page | user:manage | 用户分页（脱敏） |
| GET /api/admin/v1/users/:id | user:manage | 用户详情（脱敏） |
| GET /api/admin/v1/users/:id/phone | user:manage | 查看完整手机号（**强制审计** `user.phone_revealed`） |
| POST /api/admin/v1/users/:id/disable · /enable | user:manage | 禁用/启用（审计；禁用撤销全部会话） |

- 幂等语义：logout 幂等；设默认幂等；disable/enable 幂等；login 非幂等但重复 code（已用）返回 401 `WECHAT_CODE_INVALID`。
- 会话过期行为：任何 user 接口 401 `UNAUTHENTICATED` → 小程序清本地态进入未登录。

## 4. 页面设计（小程序）

- **我的页（profile，改造）**：未登录态（说明文案 + "微信一键登录"按钮）；已登录态（昵称、手机号徽标"已绑定/未绑定"、注册时间）；操作：修改昵称（弹出输入）、绑定/换绑手机号（`button open-type="getPhoneNumber"`，拒绝授权有明确提示）、收货地址入口、退出登录。加载/失败/重复点击状态齐备。
- **地址列表页**（新增 `features/address/pages/list`）：列表（默认徽标）、新增入口、条目操作（编辑/删除/设默认）、空态、失败态、未登录态。
- **地址表单页**（新增 `features/address/pages/form`）：新增/编辑复用；省市区选择（picker mode=region）、详细地址输入、字段校验与后端一致；删除需确认；保存中禁用重复点击。
- 登录态存储：`wx.setStorageSync('pindian_user_token')`；401 自动清除并提示重新登录。mock 模式标注沿用现有约定（无凭据环境以"未配置"真实反馈为主，不提供假登录 Mock 成功——Mock 仅本地开发态标注）。

## 5. 页面设计（后台）

- **用户管理页**（导航"权限与审计"下新增"用户管理"入口 `#/users`）：列表（昵称、脱敏手机号、状态徽标、注册时间、最近登录、关键字/状态筛选、分页）；详情抽屉（注册信息+状态操作）；"查看完整手机号"按钮 → 确认框（说明将记录审计）→ 显示并提示已审计；禁用/启用需确认并显示后果说明。

## 6. 关键场景 Given/When/Then

- G1 G 未登录，W 打开"我的"页，T 显示未登录态与登录按钮；商品列表可正常浏览（游客）。
- G2 G 首次登录，W 提交有效 code，T 创建用户+身份并签发会话，`isNewUser=true`。
- G3 G 同一微信重复登录，T 关联同一用户，`isNewUser=false`，不产生重复身份。
- G4 G 两个并发首次登录（同 openid），T 仅一个用户创建成功（唯一约束兜底，两者最终拿到同一 userId）。
- G5 G 提交无效/已用 code，T 401 `WECHAT_CODE_INVALID`，无会话产生。
- G6 G WX 凭据未配置，W 登录，T 503 `WECHAT_NOT_CONFIGURED`，不产生用户。
- G7 G 会话过期后调用 /auth/me，T 401；小程序清态回未登录。
- G8 G 退出登录后旧 token 访问受保护接口，T 401（仅当前会话撤销）。
- G9 G 用户 A 的 token 访问 B 的地址（GET/PATCH/DELETE/设默认），T 404（不泄露存在性）。
- G10 G 地址字段非法（姓名空/手机号格式错/详情过短），T 400 且不写入。
- G11 G 20 条满后再新增，T 409 `ADDRESS_LIMIT_REACHED`。
- G12 G 并发对同一用户设置两个不同默认地址，T 两个请求均成功但最终仅一个默认（后提交者生效，唯一索引兜底无脏数据）。
- G13 G 删除默认地址，T 成功且该用户处于无默认态；再次新增不自动默认。
- G14 G 手机号验证失败（code 无效/微信错误），T 400/502 且 `phone_verified_at` 保持为空，不标记绑定成功。
- G15 G 无 `user:manage` 权限的 admin 调用用户接口，T 403。
- G16 G 管理员查看完整手机号，T 返回原文且 `admin_operation_logs` 新增 `user.phone_revealed` 记录（含 adminId/userId/requestId）。
- G17 G 列表/详情响应中手机号均为脱敏格式；无 reveal 意图的接口不返回原文。
- G18 G 禁用用户，T 状态 disabled、其全部会话失效（旧 token 401 `USER_DISABLED`）、再次登录 403 `USER_DISABLED`；启用后可登录。
- G19 G 服务重启（容器重建不删卷），用户/地址/会话数据保持存在。

## 7. 验收条件（AC）

- AC01 登录/会话/登出/过期/禁用路径全部按 G2–G8、G18 验证（TDD+集成）；并发首次登录不重复建户（G4）。
- AC02 无凭据环境：登录返回明确的 `WECHAT_NOT_CONFIGURED`，文档记录缺失，不伪造成功（G6）。
- AC03 手机号绑定仅由服务端验证事实驱动（G14）；昵称修改合法校验；资料展示不冒充可信身份。
- AC04 地址 CRUD+默认地址全规则（G9–G13）；归属与后台权限服务端强制。
- AC05 后台用户列表/详情/脱敏/审计/禁用（G15–G18）；`user:manage` 权限点生效。
- AC06 小程序三页（我的/地址列表/地址表单）覆盖加载/空/失败/未登录/过期/授权拒绝/重复点击状态；接入真实后端（无凭据项如实标注）。
- AC07 契约（contracts + OpenAPI）与实现一致；T002 能力回归通过（登录、商品、图片、小程序商品展示）。
- AC08 迁移 0006–0008 可重复执行；旧数据（admins/products/media）不受影响；服务重启数据保留（G19）。
- AC09 `npm run test:task:t003` 专项通过 → `npm test` 全量通过 → Docker 冒烟通过。
- AC10 微信真机/真实凭据验证缺失项如实记录（AC02 关联），不标记完整验收。

## 8. 待决策项（不阻塞本任务）

| 事项 | 本任务处理 | 决策归属 |
| --- | --- | --- |
| unionid 多端身份合并 | 仅存 unionid 字段，不做合并逻辑 | 后续身份任务 |
| 头像上传与存储用途隔离 | 预留不启用 | 后续任务（含 media 用途扩展） |
| 手机号唯一性（一号多户） | 不强制唯一 | 后续交易/风控任务 |
| 删除默认地址是否自动补默认 | 不自动补（可预测优先） | 交易任务可重议 |
| 后台查看地址簿 | 本阶段不开放 | 履约阶段按需+权限 |
| 用户操作日志（小程序侧） | 不记录（仅管理员审计） | 后续审计任务 |
