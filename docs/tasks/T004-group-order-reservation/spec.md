# T004 功能规范

依据：[需求文档 §2/§3.4–3.6/§6.3](../../requirements/pindian-shopping-mini-program-requirements.md)、[T004 DDD](ddd.md)、[已确认决策 D001–D005](decisions/)。

## 1. 目标、范围与非目标

**目标**：完整实现"选品→匹配→预占→报价→待支付订单→订单/组查询"业务闭环（不含支付）；库存与容量在并发下守恒。

**非目标**：真实微信支付/退款/回调、成功后取消、迟到支付补偿、履约拆分、客服/工单、优惠券会员。订单在本阶段只能处于 unpaid/cancelled/expired（paid 仅内部用例测试可达）。

## 2. 已确认规则汇总

全部不变量见任务 prompt 第五节（60 单位制、容量上限、预占不计支付、60 才成功、匹配优先级、精确可完成性、整数分、+500 服务费、服务端权威、四域分离建模）。业务决策见 D001–D005：预占时最后单补差、建组预留→成功消耗→失败释放、组快照+下架禁新预占、预占 15 分钟/截止商品可配 24h、支付边界声明。

## 3. 场景

### 3.1 小程序用户

- S01 选择份额下单：商品详情选允许份额 → 选地址 → 提交（自动生成幂等键）→ 返回订单（报价、预占到期时间、组状态"拼单中"）。
- S02 重复提交（网络超时重试）：同幂等键同内容 → 返回原订单（200，非新建）；同键不同内容 → 409 `IDEMPOTENCY_CONFLICT`。
- S03 订单列表/详情：仅本人；详情含金额明细（商品/服务费/尾差）、地址快照、组摘要（组号、已支付单位、剩余、截止时间、组状态）、预占到期倒计时（后端时间）。
- S04 取消未支付订单：释放份额预占；订单 `cancelled`；组容量回落。
- S05 竞争/失败反馈：份额竞争失败（重试后仍失败）409 明确提示可重试；库存不足 409；商品下架 409；未登录 401；空列表空态。
- S06 支付状态展示：订单页固定提示"微信支付暂未开放"，未支付订单绝无"已支付/拼单成功"展示。

### 3.2 后台管理员

- S07 订单查询：`order:manage` 权限；列表（状态/关键字=订单号/昵称筛选、分页、手机号脱敏）；详情（金额明细、快照、组信息）。
- S08 拼单组查询：列表（状态筛选、分页）；详情（快照、已支付/预占单位、剩余容量、截止时间、成员订单摘要：订单号/昵称/单位/状态——不显示手机号地址）。
- S09 库存预留查询：商品库存视图（available/reserved）+ 变动记录（复用 inventory:manage）。
- S10 无"强制成功/伪造支付/改状态"接口；关键操作（内部支付生效、取消）审计。

## 4. API 契约（摘要；完整见 contracts/openapi.yaml）

| 方法与路径 | 认证 | 说明 |
| --- | --- | --- |
| POST /api/mini/v1/orders | user | 下单 `{productId, units, addressId, idempotencyKey}` → 201 `MiniOrderView`；幂等命中 200 |
| GET /api/mini/v1/orders?page | user | 本人订单分页（组摘要内嵌） |
| GET /api/mini/v1/orders/:id | user | 本人订单详情 |
| POST /api/mini/v1/orders/:id/cancel | user | 取消未支付订单（幂等语义：已取消仍 200；paid/expired 409） |
| GET /api/admin/v1/orders?status&keyword&page | order:manage | 订单分页 |
| GET /api/admin/v1/orders/:id | order:manage | 订单详情 |
| GET /api/admin/v1/groups?status&productId&page | order:manage | 组分页 |
| GET /api/admin/v1/groups/:id | order:manage | 组详情（成员摘要） |
| GET /api/admin/v1/products/:id/stock | inventory:manage | 库存视图（available/reserved/consumed 合计） |

- 下单请求：units ∈ 快照允许集合；idempotencyKey UUID 必填。响应 `MiniOrderView {orderId, orderNo, status, units, quote{totalAmountFen, goodsAmountFen, serviceFeeFen, tailAdjustFen, isFinalOrder}, addressSnapshot, group{groupId, paidUnits, reservedUnits, remainingCapacity, deadline, status}, reservationExpiresAt, createdAt}`。
- 错误码新增：`IDEMPOTENCY_CONFLICT`(409)、`SHARE_CAPACITY_CONFLICT`(409)、`STOCK_INSUFFICIENT`(409)、`GROUP_NOT_JOINABLE`(409)、`PRODUCT_NOT_ON_SHELF`(409)、`ORDER_NOT_CANCELLABLE`(409)、`ADDRESS_NOT_FOUND`(404)、`SHARE_UNIT_INVALID`(400)。
- 幂等语义：下单按 (userId, idempotencyKey) 幂等（同内容返回原单、异内容 409）；取消幂等（终态已取消仍成功）；后台查询只读。
- 会话过期：401 `UNAUTHENTICATED` → 小程序回登录态。

## 5. 前端页面设计

### 小程序

- **商品详情页改造**：份额卡片变为可选中（仅参考价，标注"以提交结果为准"）→ 底部按钮"选择份额并下单"→ 登录检查 → 地址选择（默认地址预选，可换/新建，来自 T003 地址簿）→ 确认提交（显示参考金额；提交中禁用重复点击）。
- **订单列表页**（新增 features/orders 扩展，Tab 已有）：状态分区（进行中/已完成/已关闭）简化为列表 + 状态徽标；分页；空态/失败/未登录态。
- **订单详情页**（新增）：状态、金额明细（商品金额/服务费/尾差调整/应付）、地址快照、组摘要（进度 60 单位可视化：已支付/预占/剩余）、预占到期倒计时（后端 expiresAt）、"取消订单"（未支付）、支付未开放提示。
- 状态覆盖：加载/空/失败/未登录/过期（401→重新登录）/库存不足/竞争失败/下架/重复点击。

### 后台

- 导航"拼单与订单"激活为真实页面：订单列表/详情（金额明细、快照、成员）、组列表/详情（成员订单摘要、进度、截止）、商品库存视图入口（商品列表跳转或独立查询）。

## 6. 关键场景 Given/When/Then（编号供验收映射）

- G1 所有允许份额及混合组合可精确判断（DP 全表对拍穷举）。
- G2 不可完成余量（如 1/3+1/3 后剩 20→可；剩 10→不可）不被接受。
- G3 多组匹配：剩余 15/20/30 的三个组买 15 → 选剩余 15 的组（最接近拼满）；同剩余按创建时间。
- G4 两人同买最后 20：一人成功（最后单补差），另一人重试后建新组或 409。
- G5 并发建组不超卖：库存 2 件、5 并发 → 恰 2 组成功。
- G6 幂等：同键重试返回原单不重复占容；同键异内容 409。
- G7 DB 失败回滚：注入故障时组/预占/订单/库存四者同生同灭。
- G8 预占过期：任务释放容量与订单；重复执行与重启后不重复处理。
- G9 报价过期场景：预占过期后支付生效（内部用例）被拒。
- G10 尾差：1/3×3 组合计恰为整件价；商品/服务费分别守恒。
- G11 地址归属：B 用 A 的 addressId 下单 404；订单地址快照在地址被删/改后不变。
- G12 越权：用户读他人订单 404；无 order:manage 的 admin 403。
- G13 组快照：改价/改份额后旧组按快照匹配与报价；下架后新预占被拒、组内未支付可继续（支付生效内部用例可达）。
- G14 客户端篡改金额：接口不接受金额字段，报价全部服务端计算。
- G15 竞争重试上限：3 次后返回 SHARE_CAPACITY_CONFLICT，不无限循环。

## 7. 验收条件（AC）

- AC01 匹配与可完成性符合 G1–G3（纯函数 TDD 全覆盖，含与穷举对拍）。
- AC02 下单事务与并发符合 G4–G7（真实 PG 集成，行锁/条件更新/唯一约束实证）。
- AC03 报价与尾差符合 G10（含不可整除与混合份额矩阵）。
- AC04 过期/截止任务符合 G8–G9（含重复执行与重启恢复）。
- AC05 幂等与篡改防护符合 G6/G14。
- AC06 地址归属与快照符合 G11。
- AC07 权限与脱敏符合 G12；组摘要不暴露手机号/地址。
- AC08 小程序下单/订单页接入真实后端，覆盖任务第六节状态；无支付按钮/无伪造支付。
- AC09 后台三个查询页可用，无改状态/强制成功接口。
- AC10 T002/T003 回归通过；`npm run test:task:t004` → `npm test` → Docker 冒烟通过。
- AC11 迁移 0009–0012 可重复执行，旧数据保留。
- AC12 契约与实现一致（contracts + OpenAPI）。

## 8. 待决策项

无阻塞项（D001–D005 已确认）。遗留到后续阶段：支付接入时的迟到支付/退款、履约数量精度、成功后取消。
