# T006 独立验收（2026-10-01）

> 最新审查基线 `85dd357`：仍未通过。真实支付/库存回滚缺陷已修复，但本轮专项实际 50/51，并发支付确认误建退款在整套专项与独立集成重跑中均失败；重复退款成功回调不幂等。详见文末“第三轮独立审查”，之前记录保留追溯。

> 最新独立复验：对 `8c86e9d` 的结论仍为未通过。专项 49/49、全量 168/168、Docker 冒烟通过，但真实 PostgreSQL 故障注入证明 A03 的生产事务边界尚未修好。以下原验收记录保留用于追溯，最新结果见文末“第二轮独立复验”。

## 结论与范围

**未通过，不执行“验收成功后提交 Git”。** 本轮验收基线为 `958ff9c`，用户要求验收、成功后提交以及提供下一阶段提示词。只核查、运行测试和回写验收文档，没有修改业务代码，没有提交或推送 Git，没有处理其他任务的已有修改。

现有测试通过，但没有覆盖以下全部业务失败路径。缺少真实微信商户配置和真机环境另行记录，不能用该环境缺失解释已复现的本地实现缺陷。

## 实际执行

| 命令或操作 | 实际结果 | 范围 |
| --- | --- | --- |
| `git status --short`、`git log -6 --oneline`、`rg` / `Get-Content` | 完成 | 核对源码、任务文档、生产装配、前端和现有测试 |
| `npm run test:task:t006` | 35 通过、0 失败、0 跳过 | 包含真实 PostgreSQL + HTTP + 本地假渠道集成；构建、类型和架构检查通过 |
| 专项通过后执行 `npm test` | 154 通过、0 失败、0 跳过 | 含 T002–T004 数据库集成回归 |
| `npm run smoke:docker` | 退出码 0，冒烟通过 | PostgreSQL、API 就绪、后台代理、构建资产、公开契约、Worker 健康；该冒烟不等于两端交互完整通过 |
| `docker compose ps` | postgres/api/worker/admin 均 healthy | 当前容器运行状态 |
| PowerShell here-string 管道 `node`（使用刚构建的生产类，固定虚构密钥/数据） | 三个缺陷探针复现，见下 | 回调验证器、组截止任务、支付确认工作流；使用本地替身，不写主业务库、不访问真实微信 |

## 必须修复的验收缺口

### A01：生产回调验证器未执行 RSA 验签（AC01 / AC09）

代码：`backend/src/contexts/payments/adapters/outbound/wechat/wx-pay-notify-verifier.ts`、`backend/src/contexts/payments/adapters/inbound/public/payment-notify.controller.ts`、`backend/src/bootstrap/foundation.module.ts`。

探针用固定虚构 APIv3 密钥构造合法 AES-GCM resource，分别调用生产 `WxPayNotifyVerifier.verify(body, {})` 和传入错误签名头的 `verify`。实际输出：

```json
{"withoutHeaders":true,"invalidSignature":true,"expected":false}
```

这证明签名头没有被校验；不表示没有 APIv3 密钥的攻击者也能构造合法密文。`HttpWxPayAdapter.verifyNotifySignature` 的独立单测通过，但该方法未接入生产回调验证器。控制器重新 `JSON.stringify` 已解析的请求体，入口也没有启用原始请求体保留；不能直接把该文本用于真实报文验签。

应在生产装配中强制验签，缺公钥/证书或签名不合法时拒绝处理；补充有空白/换行的原始报文、缺签名及错误签名的 HTTP 回归。

### A02：已支付拼单组截止后未创建退款（AC03 / AC05）

代码：`backend/src/workflows/order-expiry.tasks.ts`、`backend/src/bootstrap/worker.ts`。

探针将一个 open、已支付 20 单位、deadline 已过的生产 Group 注入 `FailDeadlineGroupsTask`；记录库存释放、订单状态和退款调用。实际输出：

```json
{"groupStatus":"failed","orderStatus":"paid","releaseCalls":1,"refundCalls":0,"expectedRefundCalls":1}
```

生产任务只失效未支付预占并释放整件库存，没有扫描已支付订单或创建 `group_failed` 退款。Worker 的退款驱动只能处理已经存在的退款单，无法补上这个缺口。需覆盖组失败退款创建、重复执行、部分处理失败和重启恢复。

### A03：迟到支付退款建单失败后无法通过重复回调恢复（AC04 / AC05）

代码：`backend/src/workflows/payment-confirm.workflow.ts`。

探针使用生产 Payment 和 ConfirmPaymentWorkflow，注入 expired 订单；第一次创建退款时抛出“注入：退款建单失败”，随后重放同一支付事实。实际输出：

```json
{"paymentStatus":"succeeded","appliedResult":"refunded_not_applied","refundCreationAttempts":1,"retryResult":true,"expectedRetryCreatesRefund":true}
```

第一次处理先保存 succeeded/refunded_not_applied，再建退款；建单异常后，重复回调在 `payment.state.status === 'succeeded'` 分支直接返回，没有再次建退款。支付查询仅补偿 unknown/processing，退款驱动也找不到尚未创建的退款单。需可靠记录待退款动作，允许事务回滚或持久化补偿，验证故障恢复后恰好一笔退款。

### A04：取消/失效订单的退款进度被页面主动清空（AC06）

代码：`apps/mini-program/miniprogram/features/orders/pages/detail/index.ts` 的 `loadRefunds`。

源码仅在 `order.status === 'paid'` 时加载退款；已支付取消后为 cancelled，迟到支付退款订单为 expired，两者都直接清空 `refundItems`。真实接口存在不能替代页面验收。需在这些状态查询并展示 requested/processing/succeeded/failed 等退款进度，并区分查询失败与无记录。

### A05：D006 平台让利台账尚未落地（AC02）

核查 `GroupState`、组成功工作流、后端迁移与 contracts，搜索 `settlement`、`settled`、`settlement_diff`、`settlementDiff` 没有找到已承诺的结算差额存储/台账。现有集成仅比较订单金额之和与组已支付累计金额，没有断言整件售价差额台账。

需依据已有 D006 决策保存可追溯差额，补不可整除、混合份额、取消重组与乱序支付验收，不能把“累计金额相等”解释为让利台账已经存在。

## 其他必须补充的验证

- 已支付取消宣称同事务，但 `CreateFullRefundUseCase.execute` / `PostgresRefundRepository.insert` 没有接收外层 `sessionTx`；退款插入走独立连接。需真实 PostgreSQL 故障注入，验证后续订单/组更新失败时不会留下可被 Worker 处理的孤立退款单。本轮为源码风险确认，未执行事务回滚故障注入。
- 支付查询结果用例只读取本地订单，未调用渠道；页面刷新不能等同于后端查单。需按 spec 验证补偿与刷新语义。
- 未找到退款回调 HTTP 入口；当前集成靠退款查询达到 succeeded，不能宣称退款回调已经通过。
- 本轮没有执行浏览器交互、微信开发者工具、真机或真实商户验证；原记录中“页面构建与路由可达”不应称为完整浏览器交互冒烟。

## 后续顺序与提交边界

先在 T006/F020–F025 原目录按 DDD/spec/plan 修订，再用 TDD 补缺陷回归，修复上述缺口。完成真实数据库/HTTP及两端专项 → 全量 → Docker 冒烟后再次独立验收。通过后只提交该任务相关变更，保留协调目录和 T005/F019 既有修改。

T006 尚未通过，因此下一轮提示词应指向 T006 缺陷修复与复验；通过后再启动新的分份履约任务，先确认数量精度、舍入与补差规则。

## 2026-10-01 第二轮独立复验（基线 8c86e9d）

用户要求查看真实状态。本轮确认 zcode 已本地提交 `8c86e9d`（39 文件，包含新增回归测试、迁移 0015、回调验签/原文接入、组失败退款、页面和台账修复）。不是沿用旧验收结论。

### 实际执行结果

- `npm run test:task:t006`：49/49 通过，0 失败，0 跳过，含真实 PG + HTTP 集成。
- 专项通过后 `npm test`：168/168 通过，0 失败，0 跳过。
- `npm run smoke:docker`：退出码 0；`docker compose ps`：四个容器 healthy。
- 源码确认 A01、A02、A04、A05 的实现已变更；退款回调及刷新查单也有生产装配。没有在本轮操作浏览器/开发者工具/真机，不能把这些动作写成本轮已验证。
- 全量测试结束后，以 PowerShell here-string 管道 `node` 执行 **真实 PostgreSQL + 生产支付仓储/订单仓储/确认工作流 + 真实 BEGIN/ROLLBACK** 故障探针。连接路径强制为 `/pindian_t006_test`，没有连接主业务库。取测试库已过期订单的支付单，保存原快照，暂置 processing；注入退款建单抛错；重放同一事实；finally 恢复原支付快照并关闭连接。

### A03 仍未修复的生产证据

```json
{
  "database": "pindian_t006_test",
  "probe": "真实PG退款建单失败回滚及回调重放",
  "error": "独立复验：退款建单故障",
  "paymentStatusAfterRollback": "succeeded",
  "appliedResultAfterRollback": "refunded_not_applied",
  "refundCreationAttempts": 1,
  "replayResult": true,
  "expectedStatusAfterRollback": "processing",
  "expectedRefundCreationAttempts": 2
}
```

根因：`ConfirmPaymentWorkflow` 调用 `payments.save(payment, sessionTx)`，但 `PostgresPaymentRepository.save(payment)` 的生产方法仍只有一个参数，执行 `this.query` 从连接池取得独立连接，忽略传入的事务会话。因此退款建单异常时外层 ROLLBACK 不能撤销已提交的 succeeded 状态；重复回调仍在 succeeded 早退分支返回，不补建退款。

现有 A03 单测使用 `RollbackRunner` 人工恢复 Fake 仓储状态，掩盖了生产适配器忽略事务参数的问题。现有真实 PG 故障注入验证的是“已支付取消”退款回滚，没有注入“迟到支付确认”退款建单失败；二者不能互相替代。

**结论：修复确实有进展，49/168 项测试结果真实，但独立验收仍未通过。** 下一步贯穿 PaymentRepository 的事务参数（尤其 save 与必要读取），补充本探针对应的真实 PG 回归，并审查库存消耗是否同样脱离外层事务；后者本轮仅源码发现风险，未做故障复现。真实商户/真机及完整前端行为验收仍未完成。

本轮只回写独立验收和 README 状态，没有修改业务代码，没有新增 Git 提交；zcode 已有提交保留，协调目录与 T005/F019 未处理。

## 2026-10-01 第三轮独立审查（基线 85dd357）

用户要求审查 zcode 新交付。最新提交 `85dd357` 已实际修正 PaymentRepository 与 StockReservationPort 的事务参数，并新增 `confirm-tx.test.mjs` 真实 PG 故障回归。审查没有修改业务代码。

### 实际验证

| 操作 | 结果 |
| --- | --- |
| `npm run test:task:t006` | **50 通过 / 1 失败 / 0 跳过，退出码 1**；类型检查、构建、架构检查通过 |
| 新增支付/库存事务回归 | 两项真实 PG 故障回归均通过：退款建单失败回滚后重放，组成功落账失败时库存消耗回滚 |
| `node --test tests/task-suites/t006/integration-db-http.test.mjs` | 单独重跑同一集成仍失败，0 通过 / 1 失败，退出码 1 |
| `npm run smoke:docker`、`docker compose ps` | 冒烟通过，四容器 healthy；不代表并发资金流程通过 |
| 独立 PG 查询 | 只查询 `/pindian_t006_test`，确认下述已支付订单与错误退款事实，没有写主业务库 |
| 生产 Refund / RefundResultConfirmer 双次通知探针 | 第二次相同 SUCCESS 事实抛 REFUND_NOT_ALLOWED；使用内存仓储替身，未调用真实微信 |
| 项目全量 / 浏览器 / 微信真机 | **本轮未执行**；专项失败，未进入“专项通过后全量”的验收阶段；不能沿用开发自测 170/170 作为本轮结果 |

### [P1] 并发支付确认将有效支付误判为迟到支付并创建全额退款

位置：`backend/src/workflows/payment-confirm.workflow.ts`，初始支付状态读取/早退（57–64 行）、加组锁前订单读取（77–80 行）、预占检查（82–83 行）以及后续退款分支（115 行起）。

现有集成在回调与查单 `Promise.all` 后，于 `tests/task-suites/t006/integration-db-http.test.mjs:326` 失败：期望 applied，实际 refunded_not_applied。整套专项和单独重跑两次均失败。

真实测试库查询结果：

```json
{
  "order_status": "paid",
  "payment_status": "succeeded",
  "applied_result": "refunded_not_applied",
  "paid_units": 20,
  "refund_reason": "late_payment",
  "refund_status": "requested",
  "refund_amount": 16833
}
```

影响：用户支付已经生效、订单仍 paid、组内保留 20 支付单位，却存在一笔 16833 分待驱动的全额退款；不是仅展示状态错误。

根因：两次确认可同时读取 processing，早退检查在事务外。第二次确认等待组锁时，第一次已将预占转换；第二次拿锁后看到 converted 预占或已变更订单，走“不可生效→迟到退款”，没有在锁保护内重读支付已应用事实、作幂等返回。旧 Payment 快照被写成 refunded_not_applied。组锁保证容量更新串行，但没有保证支付确认的幂等判定与资金动作串行。

修复应明确统一锁顺序，在事务及锁保护内读取并判断支付/订单/预占的最新事实；同一已生效支付重放只能幂等返回，不得走迟到退款或覆盖 applied。回归应通过同步屏障固定两次确认同时读取旧状态、一次等待锁的时序，覆盖回调×回调、回调×查单、查单×查单；保留原真实 PG/HTTP 断言，不能通过移除并发或放宽断言规避。

### [P1] 相同退款 SUCCESS 通知重复处理报错

位置：`backend/src/contexts/payments/application/refund-flow.ts:180`、`backend/src/contexts/payments/domain/refund.ts:78`。

探针使用生产 Refund 从 submitted→processing 开始，连续两次调用生产 RefundResultConfirmer，传入相同 outRefundNo、SUCCESS 和 channelRefundId。第一次返回 succeeded；第二次抛出：

```json
{"code":"REFUND_NOT_ALLOWED","message":"退款单当前状态不可标记成功"}
```

原因：`markSucceeded` 只允许 processing/submitted，没有对 succeeded 的同事实幂等返回；支付退款 HTTP 回调入口直接调用 confirmer，该错误映射为 409，渠道不能获得成功受理应答。与查询并发或通知重投都可能遇到已成功状态。需要验证相同事实幂等受理、重复不写账，并拒绝互相冲突的渠道事实；结果确认应具备并发保护，不能用旧查询快照覆盖终态。

### 本轮结论及下一步

**独立审查未通过。** 已确认上轮事务贯穿修复有效，但新并发资金错误及退款回调幂等问题需修复并补回归。专项失败，因此本轮不重新运行全量、不做完成性 Git 提交；zcode 已有 `85dd357` 提交保留。README 回写为验证中，开发自测报告作为历史记录保留，不能表示本轮验收通过。
