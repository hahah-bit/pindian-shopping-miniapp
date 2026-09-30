# F011 spec

上游：[T003 spec](../../tasks/T003-user-identity-address/spec.md) §2（决策 6、8）、§3（契约）、§4（地址两页）、§6（G9–G13）。本文件细化验收条件。

## 接口契约细节

- `AddressView`：`{id, receiverName, phone, province, city, district, detail, isDefault, createdAt, updatedAt}`（手机号对本人展示原文——用户看自己的地址不脱敏；仅后台接口脱敏）。
- `POST /api/mini/v1/addresses`：body `{receiverName, phone, province, city, district, detail}`；201 AddressView；400 校验失败（message 指明字段）；409 `ADDRESS_LIMIT_REACHED`。
- `GET /api/mini/v1/addresses`：200 `{items: AddressView[]}`（默认在前，其余按 updatedAt 倒序）；空数组合法。
- `PATCH /api/mini/v1/addresses/:id`：200 更新后视图；404 不存在或不属于本人。
- `DELETE /api/mini/v1/addresses/:id`：200 `{deleted: true}`；404 同上。
- `PUT /api/mini/v1/addresses/:id/default`：200 `{items: AddressView[]}`（返回刷新后列表）；幂等（已是默认仍 200）；404 同上。
- 所有接口 user realm；401 未认证。

## 行为规则

1. 归属：一切读写以 token 用户为作用域；他人地址一律 404（不泄露存在性）。
2. 校验失败不写入（G10）；字段规则与前端一致（前端即时校验 + 后端权威）。
3. 上限 20（G11）；满员新增 409，提示先删除。
4. 默认唯一：并发设默认最终仅一个默认（G12，后提交生效）；设默认幂等；无默认态合法。
5. 删除默认后不自动补（G13）；首次新增不自动默认。
6. 微信地址导入：本阶段不接入 `wx.chooseAddress`（避免额外授权面）；若后续加入仅辅助填表，后端仍全量校验。

## 验收条件

- AC-F11-1 CRUD 全路径（单测+集成），字段校验矩阵（姓名/手机号/省市区/详情长度）拒绝并指明字段。
- AC-F11-2 归属：用户 B 访问 A 的地址 404（GET/PUT/PATCH/DELETE 全方法）。
- AC-F11-3 默认：设默认生效且旧默认清除；并发两个设默认终态唯一；幂等重复调用安全。
- AC-F11-4 上限：第 21 条 409；删除后可再新增。
- AC-F11-5 删除默认 → 无默认态；列表默认置顶排序正确。
- AC-F11-6 小程序两页：空态/加载/失败/未登录/校验错误/删除确认/重复点击禁用（页面冒烟 + 接口集成）。
