# T006 实际验收记录

> 2026-10-01 独立验收历程：第一轮未通过（A01–A05）→ 第二轮修复后独立复验仍未通过（生产事务缺陷，基线 8c86e9d）→ 第三轮修复（生产事务贯穿）→ 第三轮独立审查再发现两处并发幂等 P1（基线 85dd357）→ 第四轮修复（本记录）。历次结论与证据见 [independent-acceptance.md](independent-acceptance.md)；独立复验由验收方执行，本记录为开发自测。

日期：2026-10-01（Asia/Shanghai）。第二轮：针对独立验收 A01–A05 及附加验证项（事务边界/退款回调/刷新语义）逐项修复。结论：**修复完成、自测通过；真实商户渠道与真机仍待用户环境，不标记渠道已验证**。

## 修复对照（独立验收缺口 → 修复与验证）

| 缺口 | 修复 | 验证（先红后绿） |
| --- | --- | --- |
| A01 生产回调未验签 | `WxPayNotifyVerifier` 强制平台公钥 RSA 验签（串 = `timestamp\nnonce\n原始报文\n`）：未配置公钥/缺任一头/错签名/超窗（>5min）一律拒绝；控制器改用 Nest `rawBody` 原始字节验签，缺失即 400；验签通过才解密 | notify-verify 单测 6/6（合法/缺公钥/缺头×4/错私钥/报文不匹配/空白报文原文验签/超窗/退款事件/mchid 不匹配/篡改/非法 JSON）；集成场景 0：无签名 400、错私钥 400、**重新序列化报文 400**、原文（含空白）验签 200 |
| A02 组截止不退款 | `FailDeadlineGroupsTask` 第二阶段：扫描 failed 组内 paid 且无退款单订单 → 逐单独立事务建 `group_failed` 全额退款；已有退款不重建（查重+`refunds.payment_id` 唯一约束）；单笔失败不阻塞、下轮重扫恢复 | group-failure-refund 单测 4/4（建单/幂等/部分失败重扫补齐/无 paid 不建）；集成场景 4：组2 截止 → 组 failed + 退款 requested（12625 分全额），重复执行不重复 |
| A03 迟到退款不可恢复 | 确认工作流事务化：应用/支付事实/迟到退款**同一事务**（含防崩溃窗口：applied 路径的支付事实也入事务）；退款建单失败整体回滚，支付单停留原态可重放；`RefundCreationPort`/`CreateFullRefundUseCase` 贯穿 sessionTx | payment-confirm 单测 10/10（新增：建单失败回滚不落 succeeded + 重放恰一笔退款；同事务会话断言）；集成场景 2 迟到支付全链路保持通过 |
| 事务边界（附加验证） | `PostgresRefundRepository.insert/save` 接收 sessionTx；取消已支付工作流传递 sessionTx | **真实 PG 故障注入**（集成场景 3）：取消流程组扣减步骤注入失败 → 退款单回滚（无孤立退款单）、订单保持 paid、组容量未扣；随后真实取消成功 |
| A04 退款进度被清空 | 小程序 loadRefunds：cancelled/expired 同样查询展示；查询失败显式提示 + 重试按钮，与"无退款记录"区分 | 代码实现 + admin/mini 构建通过；页面行为（开发者工具/真机）待用户环境，已如实记录 |
| A05 让利台账缺失 | 迁移 0015 `group_settlements`（group_id 唯一幂等）；组 success 同事务落账 expected（整件售价快照）/settled（Σ已支付订单应付）/diff（让利）；组截止失败不落账 | payment-confirm 单测（落账字段+同事务+未满不落账）；集成场景 1：20×20×20 → expected 50500 / settled 50499 / **diff 1 可追溯**；场景 5：仅 success 组有台账 |
| 退款回调缺失（附加） | notify 按 event_type 分发：TRANSACTION.* → 支付确认；REFUND.SUCCESS/ABNORMAL/CLOSED → `RefundResultConfirmer`（渠道退款单号随证据落库）；未知类型受理不处理 | 集成场景 2/3：退款回调（真实签名+加密，AAD=refund）→ succeeded 且 channel_refund_id 落库（wxr-cb-1/wxr-cb-2）；notify-verify 单测覆盖 REFUND.SUCCESS 解密 |
| 刷新≠查单（附加） | `PaymentQueryResult` 在 payment 处于 processing/unknown 时主动渠道查单并走确认流程；已成功不查渠道；查询失败返回本地事实（补偿任务兜底） | payment-refresh 单测 3/3；集成场景 1：processing 单刷新 → 官方查单路径 → applied/paid；已支付刷新不再访问渠道 |

## 第三轮修复（2026-10-01 第二轮独立复验：生产事务贯穿）

第二轮复验以真实 PostgreSQL 故障探针证明：`PostgresPaymentRepository.save` 忽略 sessionTx（走连接池独立连接），退款建单失败后外层 ROLLBACK 无法撤销已写入的 succeeded/refunded_not_applied，重复回调被 succeeded 早退挡住；既有 Fake 回滚测试（RollbackRunner 手动恢复状态）掩盖了生产适配器缺陷。本轮修复与证据：

### 新增真实 PG 回归（先红后绿，tests/task-suites/t006/confirm-tx.test.mjs）

生产类 + 生产仓储 + `PostgresTransactionRunner` 真实 BEGIN/ROLLBACK，独立测试库 `pindian_t006_tx_test`，不触主库：

1. **迟到支付退款建单失败（A03 生产证据复现→修复）**：注入退款建单抛错 → 外层回滚 → 支付单**必须停留 processing、无残留 applied_result、无退款单**（修复前实际 succeeded——红）；恢复后重放同一事实 → 恰好一笔全额退款（16833 分/late_payment/requested）；第三次重放幂等返回不重复建单。
2. **库存消耗随外层回滚（R12 源码风险→故障证实→修复）**：组成功路径注入结算落账失败（消耗之后、事务内最后一步）→ 回滚后订单 unpaid、预占 reserved、组 paid_units=40、支付 processing、**stocks available/reserved 恢复 (2,1)、stock_movements 无 group-consume 行**（修复前实际 (2,0)——红）；恢复后重放恰好消耗一次（台账 1 条、组 success）。

### 修复内容

- `PaymentRepository` 端口与 Postgres 适配器：`save/insert/findByOrderId/findById` 贯穿 sessionTx（`queryIn`：有会话用会话连接，缺省回退池连接）。
- **贯穿后暴露的一致性读缺口**：`CreateFullRefundUseCase` 事务外读支付单会看到未提交前的 processing → 其 `findById` 亦随 sessionTx（事务内读）。
- `StockReservationPort`（reserveOne/consumeOne/releaseOne）贯穿 sessionTx：建组预留（下单事务）、组成功消耗（确认事务）、组截止释放（截止事务）与外层同生共死；业务键幂等（movement 唯一约束）不变。预占 `findByOrderId` 事务内读贯穿。
- 端口声明同步：order-place.workflow / payment-confirm.workflow / order-expiry.tasks / catalog-stock-adapters。

### 并发与重复（集成，真实 HTTP）

- **回调与查询并发 exactly-once**：`Promise.all([notify, payment-result 刷新])` → 两者 200，支付 succeeded/applied、组 paid_units 0→20 仅一次。
- 重复回调幂等（同事实再投递）与已支付刷新不访问渠道：既有断言保持通过。

### 本轮结果

| 验证 | 结果 |
| --- | --- |
| 专项 `npm run test:task:t006` | **51/51，0 跳过**（新增 confirm-tx 真实 PG 回归 2） |
| 全量 `npm test` | **170/170，0 失败 0 跳过**（T001–T004 回归实跑） |
| Docker 冒烟 | 4 容器 healthy；主库 0001–0015；Worker 五任务运行；无签名回调 400；API ready 200 |
| 未验证项 | 真实商户渠道、微信开发者工具/真机（无配置/无环境）；平台证书多序列号轮换 |

## 第四轮修复（2026-10-01 独立审查 85dd357：并发幂等两处 P1）

独立审查以并发探针复现两处 P1（专项 50/51 失败）。本轮先红后绿修复：

### P1-1 并发支付确认错误退款

- **复现**：回调与查单并发确认同一支付，败者把 `applied` 改写为 `refunded_not_applied` 并创建 16833 分全额退款。根因：支付幂等判断在组锁外，拿锁后未基于锁内事实重判；且组满成功后 `isOpen=false` 的 `group_closed` 分支优先于"已生效"判定，使败者落入退款路径。
- **修复（R16）**：确认事务改为**组锁先行、锁内重判**——锁内重读订单（paid → 幂等成功）与支付事实（succeeded+applied → 幂等成功；pending_review → 不覆盖不退款），金额核验移入锁内；**已生效事实判定优先于组开放性判定**，组状态只约束"准备生效"的支付。结果语义三分：applied（本次或并发方已生效）/ pending_review·amount_mismatch（不覆盖不退款）/ not-applied（才允许事实改写+全额退款）。
- **回归**（confirm-tx.test.mjs，真实 PG + 生产工作流双实例 Promise.all）：修复前 `[false,true]` + `refunded_not_applied`（红）→ 修复后 `[true,true]`、payment applied、无退款单、paid_units 40+20=60、预占转换一次、消耗/让利台账各恰一条（连续 3 轮稳定）。orders.findById / payments.findByOrderId 事务内读随 sessionTx 贯穿（锁内重读依赖）。

### P1-2 重复退款成功通知不幂等

- **复现**：相同 `REFUND.SUCCESS` 第二次处理抛 `REFUND_NOT_ALLOWED`（markSucceeded 要求 submitted/processing），回调端 500 → 微信无限重试。
- **修复（R17）**：`RefundResultConfirmer` 对已达成状态幂等受理——SUCCESS 且已 succeeded → 返回 'succeeded'；ABNORMAL/CLOSED 且已 failed → 返回 'failed'；不抛错、不变更。
- **回归**（refund-flow.test.mjs，先红）：SUCCESS 二次投递、ABNORMAL 二次投递均幂等受理（修复前红）。

### 本轮结果

| 验证 | 结果 |
| --- | --- |
| 专项 `npm run test:task:t006` | **53/53，0 跳过**（新增并发确认真实 PG 回归 + 重复通知幂等单测） |
| 全量 `npm test` | **172/172，0 失败 0 跳过** |
| 并发回归稳定性 | 连续 3 轮通过 |
| Docker 冒烟 | 4 容器 healthy；Worker 五任务；无签名回调 400；API ready 200 |
| 未验证项 | 真实商户渠道、微信开发者工具/真机（无配置/无环境） |

## 官方文档核验（2026-10-01）

- 回调验签（Wechatpay-Signature 等四头、验签串构造、平台证书/微信支付公钥、必须原始报文、200/204 应答）：pay.weixin.qq.com/docs/merchant/development/interface-rules/signature-verification.html
- 退款结果通知（notify_url 随申请退款下发；REFUND.SUCCESS/ABNORMAL/CLOSED；resource 解密含 out_refund_no/refund_status/refund_id）：pay.weixin.qq.com/doc/v3/merchant/4012647469、pay.weixin.qq.com/doc/v3/merchant/4012791906
- 申请退款（out_refund_no 唯一幂等；状态 SUCCESS/CLOSED/PROCESSING/ABNORMAL）：pay.weixin.qq.com/doc/v3/merchant/4013071036

## 已确认决策

D006 标准价+平台让利台账；D007 先到先得+申请即扣容量；D008 迟到支付全额自动退款；D009 五态退款+out_refund_no 幂等；D010 单 Worker 五任务。均为 2026-10-01 用户选定（见 decisions/）。本轮台账为 D006 的落地实现。

## 测试与冒烟结果（2026-10-01 第二轮）

| 验证 | 结果 |
| --- | --- |
| 专项 `npm run test:task:t006` | **49/49，0 跳过**（notify-verify 6、confirm 10、refund-flow 8、group-failure-refund 4、payment-refresh 3、initiate 7、tasks 5、adapter 5 + 真实 PG+HTTP+本地渠道集成 1；集成覆盖 A01/A02/A03/A05/退款回调/故障注入/刷新查单） |
| 全量 `npm test`（typecheck+build+架构检查+全部测试） | **168/168，0 失败 0 跳过**（T001/T002/T003/T004 回归实跑通过） |
| Docker 冒烟 | `compose build` + 重建后 4 容器 healthy；主库迁移 0001–**0015**；Worker 五任务运行（health `businessTasksEnabled:true`）；无签名回调 400（强制验签在部署镜像生效）；API ready 200 |
| 后台浏览器交互冒烟 | 登录 → "支付与退款"页（支付单/退款单/异常队列三标签、状态筛选、空态）→ 异常队列计数与刷新按钮；F025 在部署环境可交互 |
| 小程序 | F024 实现退款进度扩展（cancelled/expired）+ 查询失败重试；**微信开发者工具/真机验证待用户环境** |

## 未验证与待用户处理

1. **真实微信渠道**：无商户配置（mchid/APIv3 密钥/商户私钥/平台公钥）。当前生产回调在未配置平台公钥时**一律拒绝**（安全默认）；配置 WX_PAY_MCHID / WX_PAY_APIV3_KEY / WX_PAY_SERIAL_NO / WX_PAY_PRIVATE_KEY_PATH / **WX_PAY_PLATFORM_PUBLIC_KEY_PATH** 后链路方可验证。`WX_PAY_ENDPOINT_BASE` 仅限联调指向本地假渠道，生产勿设。
2. 平台证书/公钥轮换与多序列号：当前按配置的单公钥验签；多序列号轮换待商户环境确定后扩展（Wechatpay-Serial 已随回调头留存）。
3. 小程序真机：wx.requestPayment 调起、cancelled/expirmed 退款进度展示、取消并退款确认框。
4. 独立复验由验收方执行；本记录为开发自测。
