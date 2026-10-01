# T006 功能规范

依据：[T006 DDD](ddd.md)、[决策 D006–D010](decisions/)（2026-10-01 确认）、[微信 v3 接口核验](README.md)。

## 1. 目标、范围与非目标

**目标**：两端真实支付退款流程（渠道交互走真实微信 v3 适配器；无商户配置时明确报错不伪造）；支付生效驱动份额/组状态；取消/失败退款五态闭环；Worker 补偿与人工处理。

**非目标**：分份发货、客服、售后工单、视觉改造（T005/F019）、优惠券会员、境外支付、H5/Native 支付方式。

## 2. 已确认决策汇总（2026-10-01）

- **D006 尾差**：下单一律标准价；组成功时 Σ实付 vs 整件价的差额（≤几分）由平台让利台账记录，不补收不退给用户。报价永不变。
- **D007 已支付取消**：仅组 open 可取消；申请即扣组容量（同事务），退款异步；与支付生效竞争以事务提交顺序裁决，先到先得；成功后仅售后提示；退款失败不回滚容量，走人工。
- **D008 迟到支付**：订单不可生效时收到成功支付 → 事实入库（不丢钱）+ 全额自动原路退款；不恢复份额。
- **D009 退款**：五态（requested/submitted/processing/succeeded/failed）；全额退款依据支付事实；out_refund_no 渠道幂等；Σ退款 ≤ 实付；失败退避重试超限转人工（权限+原因+审计）；无渠道证据不标已退款。
- **D010 Worker**：单循环五任务（预占过期/组截止/支付查询补偿/退款驱动/异常统计），全 DB 驱动、重启自恢复、互不阻断；外部调用在事务外。

## 3. 场景与 API 契约（摘要；完整见 contracts/openapi.yaml）

| 方法与路径 | 认证 | 说明 |
| --- | --- | --- |
| POST /api/mini/v1/orders/:id/pay | user | 发起支付 → `{payParams:{timeStamp,nonceStr,package,signType,paySign}, paymentId, expiresAt}`；重复发起幂等（prepay 2h 内复用）；渠道未配置 503 `WECHAT_PAY_NOT_CONFIGURED`；外部超时 202 `{paymentId, status:'unknown'}` |
| POST /api/mini/v1/orders/:id/payment-result | user | 前端回调只触发查询 → 返回订单当前权威状态 |
| POST /api/payments/v1/notify | 公开（验签） | 微信支付回调；验签失败 4xx+FAIL；成功 200 |
| GET /api/mini/v1/orders/:id/refunds | user | 本人退款记录 |
| GET /api/admin/v1/payments?status&page | order:manage | 支付单分页（含渠道交易号、金额、applied 状态） |
| GET /api/admin/v1/refunds?status&page | order:manage | 退款分页 |
| POST /api/admin/v1/refunds/:id/retry | order:manage | 人工安全重试（仅 failed；原因必填；审计） |
| GET /api/admin/v1/payment-anomalies | order:manage | 异常队列（pending_review / failed 退款） |

- 错误码新增：`WECHAT_PAY_NOT_CONFIGURED`(503)、`PAYMENT_UNKNOWN`(202 语义，body 200+status)、`ORDER_NOT_PAYABLE`(409)、`REFUND_NOT_ALLOWED`(409)、`REFUND_EXCEED_LIMIT`(409)、`NOTIFY_INVALID`(400)。
- 幂等：发起支付复用有效 prepay；回调/查询幂等（channel_transaction_id 唯一 + applied 不可重复）；退款提交同号幂等；重试仅 failed 可用。
- 金额：全部整数分；发起与回调核验 `amount.total == 订单 totalAmountFen`，不一致 → pending_review 异常。

## 4. 页面设计

### 小程序

- 订单详情（unpaid）：显示报价有效性（预占倒计时）、"发起支付"按钮 → 调起 wx.requestPayment；结果分支：成功（后端查询确认后展示"已支付，拼单中"）、用户取消（提示可重新发起）、失败（明确错误）、结果未知（202 → 轮询 payment-result）。
- 已取消/已失效订单：展示退款进度（requested/处理中/已到账）与"1–3 个工作日原路退回"说明。
- 支付未配置：明确"支付暂未配置，无法支付"。
- 状态全部以后端为准；无前端推断成功。

### 管理后台

- "支付与退款"页（order:manage）：支付单列表（订单号/用户/金额/渠道交易号/applied 状态/时间，筛选分页）、退款列表（状态/原因/重试计数）、异常队列（pending_review 支付 + failed 退款）、人工重试（原因必填 + 确认框 + 审计）。
- 订单详情联动支付/退款记录。

## 5. 关键场景 Given/When/Then

- G1 守恒：混合份额 + 不可整除场景，Σ用户实付 ≤ 整件价；组成功时差额 ≤ 几分由 D006 台账记录（DB 断言）。
- G2 越权：用户 A 发起/查询 B 的支付 404；无 order:manage 的后台 403。
- G3 幂等：重复发起返回同一 prepay；重复回调/查询不重复应用、不重复占容量；同一退款单重复提交渠道幂等。
- G4 最后份额竞争（支付生效版）：两人预占 20+20 后先后支付 → 第一笔生效填满 60 → 组 success + 整件消耗；第二笔生效时组已 success → 拒绝应用 → 全额自动退款。
- G5 取消与成功竞争：按 D007 先到先得（事务提交顺序）。
- G6 迟到支付：预占过期后渠道成功 → 事实入库 + 全额自动退款单（D008）。
- G7 回调丢失：Worker 查询补偿确认支付（D010）。
- G8 渠道超时：发起支付外部超时 → 202 unknown → 查询补偿接管，不重复下单扣款。
- G9 退款失败/重试：渠道 CLOSED/ABNORMAL → failed → 人工重试（审计）→ submitted；累计退款 ≤ 实付。
- G10 客户端篡改：支付发起不接受金额；回调金额与订单不符 → pending_review 异常证据。
- G11 组快照：支付生效按组快照容量判定，与商品当前状态无关。
- G12 数据库事务/唯一约束：channel_transaction_id、out_refund_no、(user_id, idempotency) 唯一冲突均有明确语义；崩溃后 Worker 恢复。

## 6. 验收条件（AC）

- AC01 支付单生命周期：发起（幂等/超时 unknown/未配置 503）→ 渠道事实（**生产回调强制平台 RSA 验签（缺公钥/缺签名/错签名一律拒绝）+ 原始报文体验签** + APIv3 解密入账、查询补偿）→ 生效应用（预占转换、组满判定、库存消耗）全链路 TDD + 集成。
- AC02 尾差守恒与 D006 让利台账：DB 层 Σ实付 ≤ 整件价；组成功同事务写入结算台账（expected/settled/diff 可追溯，幂等）；覆盖不可整除（20×20×20）、整除混合（30+15+15）、取消重组、乱序支付。
- AC03 已支付取消/退款：D007/D009 全规则（容量即扣、五态、幂等、上限、人工重试审计）；退款插入与**支付事实保存**贯穿 sessionTx（生产仓储适配器），同事务语义经真实 PG 故障注入验证（后续步骤失败不留孤立退款单、支付状态回滚）。
- AC04 迟到支付：D008 全额自动退款（G6）；退款建单与支付事实同事务（**生产仓储 + 真实 BEGIN/ROLLBACK 故障回归**，Fake 手动恢复不作为证据），建单失败可重放（恢复后重放恰一笔全额退款，再次重放不重复）。库存预留/消耗/释放与外层事务同生共死（故障注入验证）。
- AC05 Worker 五任务协调与重启恢复（G7/G8/G12）；组截止失败后为已支付订单创建 group_failed 全额退款：幂等、部分失败可续、重启恢复。
- AC06 两端页面：小程序支付/退款状态（**cancelled/expired 订单同样展示真实退款进度；区分查询失败与无记录**；刷新=后端渠道查单）、后台支付/退款/异常查询与重试（AC09 语义），接入真实后端。
- AC07 契约一致（contracts + OpenAPI）；错误码与状态映射齐全。
- AC08 迁移 0011–0015 可重复执行，旧数据保留（0014 台账 delta 语义、0015 结算台账）。
- AC09 安全：越权 404/403；无"标记已支付"生产端点；测试替身仅测试装配；密钥不进 Git/日志。
- AC10 `npm run test:task:t006` 专项（真实 PG+HTTP 集成）通过 → `npm test` 全量通过 → Docker 冒烟；T002–T004 回归。
- AC11 未验证项（真实商户渠道、真机）如实记录，不标记整个支付闭环完成。

## 7. 待决策项

无阻塞（D006–D010 已确认）。D001 修订（标准价 + 让利台账）已由 D006 确认覆盖。
