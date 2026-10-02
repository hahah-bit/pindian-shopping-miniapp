# T007 规格说明（spec）

依据：[需求 §5/§6.5](../../requirements/pindian-shopping-mini-program-requirements.md)、[ddd.md](ddd.md)、决策 D011–D015（建议方案）。

## 1. 目标与范围

**目标**：组成功后自动生成每用户独立履约单（整数克分配、守恒）；管理员发货/补发/改址/完成/导出；用户查看进度并确认收货。

**范围内**：F026–F030（见 README）。**范围外**：物流渠道对接、售后退货流程、客服、改址（用户侧）、自动完成超时。

## 2. 数量单位与精度（D011 已确认，2026-10-01；R01 扩展单位注册表）

- **单位注册表**：重量单位按克换算（斤=500、千克/kg=1000、克/g=1、两=50，小数允许但换算须为整数克）；计数单位按整件（个/件/只/盒/箱/瓶/包/袋等，数量须整数）；**未知单位生成时拒绝并留痕**（不缩减商品上架范围、不静默换算）。
- 存储/计算：整数**最小履约单位**（重量=克、计数=件）；历史组快照与交易不回写，展示一律回**原快照单位**。
- 分配：D011（floor + 前序补 1 g），Σ 恒等于 totalG；参考数量（3 位小数斤）仅展示，**不作为履约数量**。
- API/展示：`allocatedQuantityGrams`（整数克）+ `allocatedQuantityText`（斤，3 位小数 half-up，如 1.667）。

## 3. 接口契约

通用：鉴权 admin（bearer + order:manage）/ mini（bearer + 本人）；错误响应 `{code, message, requestId?}`；时间 ISO-8601 UTC；数量字段以 `*grams` 整数克为准。

### 3.1 管理后台（order:manage）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/admin/v1/fulfillment/groups | 待履约组分页：`?status=pending_shipment\|partially_shipped\|shipped\|completed&page&pageSize`（status=组内履约单状态汇总口径：全部同一状态才归入；默认全部）。响应 `{items:[{groupId,productId,productName,succeededAt,total,pending,partially,shipped,completed}],total}` |
| GET | /api/admin/v1/fulfillment/groups/:id | 组内明细：`{group:{...},items:[{fulfillmentOrderId,orderId,orderNo,nickname,units,allocatedQuantityGrams,allocatedQuantityText,status,receiver:{name,phoneMasked,province,city,district,detail},receiverVersion,shipments:[{id,quantityGrams,quantityText,isReissue,reissueReason,company,trackingNo,shippedAt}]}]}`（电话脱敏） |
| POST | /api/admin/v1/fulfillment/orders/:id/shipments | 发货/补发：`{quantityGrams:int>0, company:str≤30, trackingNo:str≤64, isReissue?:bool, reason?:str≤200}`。201 → `{shipment, fulfillmentOrder:{status}}`。错误：409 SHIPMENT_DUPLICATE_TRACKING / 409 QUANTITY_EXCEEDS_ALLOCATION（超发）/ 409 FULFILLMENT_NOT_SHIPPABLE（completed）/ 404。审计 `fulfillment.ship` |
| POST | /api/admin/v1/fulfillment/orders/:id/receiver | 发货前改收货快照：`{receiverName,phone,province,city,district,detail}`（校验同地址规则）；成功 version+1；发货后 409 RECEIVER_LOCKED。审计 `fulfillment.receiver_update` |
| POST | /api/admin/v1/fulfillment/orders/:id/complete | 管理员标记完成：仅 shipped；幂等（已完成重复调用 200 现状）。审计 `fulfillment.complete` |
| GET | /api/admin/v1/fulfillment/groups/:id/shipments/export | 发货单导出 CSV（UTF-8 BOM，列：履约单号/订单号/用户/分配数量(克)/分配数量(斤)/收货人/电话/省市区/详址/快递公司/运单号/发货时间/状态）；写审计 `fulfillment.export`；`Content-Type: text/csv; charset=utf-8` |

### 3.2 小程序（本人）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/mini/v1/orders/:id/fulfillment | 本人订单履约：`{fulfillmentOrder:{id,status,allocatedQuantityGrams,allocatedQuantityText,unit,shipments:[{id,quantityGrams,quantityText,isReissue,company,trackingNo,shippedAt}],receiverSnapshot:{...原文},confirmedAt,completedBy},groupSummary:{groupId,status}}`。未生成（组未成功/生成中）→ `{fulfillmentOrder:null}`（空态）。他人订单 404 NOT_FOUND |
| POST | /api/mini/v1/fulfillment-orders/:id/confirm-receipt | 确认收货：本人 + shipped 才可；幂等（completed 重复调用返回现状）；completed_by=user。409 FULFILLMENT_NOT_SHIPPABLE |

### 3.3 错误码

`FULFILLMENT_NOT_SHIPPABLE`(409)、`SHIPMENT_DUPLICATE_TRACKING`(409)、`QUANTITY_EXCEEDS_ALLOCATION`(409)、`RECEIVER_LOCKED`(409)、`VALIDATION_FAILED`(400)、`NOT_FOUND`(404)、`UNAUTHENTICATED`(401)、`FORBIDDEN`(403)。

## 4. 幂等与并发

- 生成：`fulfillment_orders.order_id` 唯一；任务重扫/重启/并发均不重复；组级事务原子。
- 发货：履约行 FOR UPDATE + 锁内守恒校验；并发两笔致超发 → 后者 409；同运单唯一约束 409。
- 完成/确认收货：幂等（终态重复调用返回现状）。
- 状态回写仅由履约聚合在锁内决定；一个用户发货不影响组内他人。

## 5. 权限与审计

- 全部管理端点 `order:manage`（后端 AccessGuard 独立成立）；收货电话列表脱敏，导出 CSV 含原文（发货必需）且写审计。
- 审计动作：`fulfillment.ship`（含补发 reason）、`fulfillment.receiver_update`（含新旧版本）、`fulfillment.complete`（含 completed_by=admin）、`fulfillment.export`。
- 小程序端仅本人（order.user_id / fulfillment.user_id 校验，他人一律 404）。

## 6. 验收条件（编号化）

- AC01 生成：组成功后自动生成每 paid 订单一张履约单；重复任务/重启/并发不重复（order_id 唯一）；组级事务原子（部分失败整组回滚重试）。
- AC02 分配守恒：整数克 + 前序补齐，Σ分配 = 整件克数；覆盖整除（20+20+20→50499 类比例的数量版）、混合份额（30+15+15）、单订单（60）、不可整除（1/3）；参考数量不等于履约数量。
- AC03 发货：数量守恒（Σ非补发=分配 ⇔ shipped）、超发 409、重复运单 409、并发发货锁内串行、completed 后拒发；部分发货统计正确（pending/partially/shipped）。
- AC04 补发：is_reissue 包裹需原因+审计，不计入发货进度，数量 >0。
- AC05 改址：仅发货前，version 递增 + 审计；发货后 RECEIVER_LOCKED；用户端无改址入口。
- AC06 完成：用户确认收货（本人+shipped）与管理员标记双路径；completed_by 区分；幂等。
- AC07 小程序：本人履约进度/包裹/运单/分配数量；空态（未生成）；他人 404；确认收货按钮仅 shipped 可用。
- AC08 导出：CSV 列齐全、含收货原文、写审计。
- AC09 权限：全部管理端点 order:manage 后端独立成立（无 token 401/无权限 403）；用户 token 401。
- AC10 集成（真实 PG+HTTP+生产装配）：重复生成、部分失败恢复、并发发货、重复发货、数量守恒、越权、事务回滚全部覆盖；跳过不计通过。
- AC11 专项→全量→Docker 冒烟→两端交互；物流/真机无渠道对接，如实记录。

## 7. Given/When/Then（关键场景）

- **Given** 10 斤组（5000g）三笔 20 份额订单按序创建，**When** 组成功生成，**Then** 分配 [1667,1667,1666]g，Σ=5000。
- **Given** 履约单分配 2500g，**When** 首笔发货 2000g，**Then** 状态 partially_shipped；**When** 再发 500g，**Then** shipped；**When** 再发 1g，**Then** 409 QUANTITY_EXCEEDS_ALLOCATION。
- **Given** shipped 履约单，**When** 用户确认收货，**Then** completed_by=user 终态；**When** 再次确认，**Then** 200 现状不变。
- **Given** 已发货履约单，**When** 管理员改收货信息，**Then** 409 RECEIVER_LOCKED。
- **Given** 同组两个管理员并发为同一履约单发货各 1000g（分配 1500g），**When** 同时提交，**Then** 恰一笔成功、另一笔 409。

## 2026-10-02 整改与确认

D019禁止所有合法有序组合的零分配；原历史快照不改，生成异常留痕，按T008/F036审核退款。D015已由用户明确确认：管理员无任何包裹时可改址、版本+1+审计；出现任何包裹后锁定。D020补发统一客服申请/超级管理员审核，原HTTP补发直达入口REVIEW_REQUIRED。修改及实际验收见 [T008整改最终验证](../T008-customer-service-after-sales/remediation-verification.md)，不以审计之后补充索引冒称先设计。
