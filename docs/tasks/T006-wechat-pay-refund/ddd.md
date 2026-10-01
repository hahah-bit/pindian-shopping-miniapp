# T006 领域驱动设计

关联：[T006 spec](spec.md)、[决策 D006–D010](decisions/)（2026-10-01 用户确认）。

## 1. 领域认领与职责边界

| 上下文 | 本任务职责 | 不做 |
| --- | --- | --- |
| Payments（主） | Payment（支付单/渠道事实）、Refund（退款单五态）、渠道端口（下单/查单/关单/退款/验签解密）、回调入站、查询补偿规则 | 不改组容量/订单状态本身（经公开能力协调） |
| GroupBuying（协作） | 支付生效：预占转已支付、组满判定（复用 T004 markPaidUnits/markSuccess）、组成功消耗整件（复用 F014 ConsumeStock） | 不理解支付单 |
| Ordering（协作） | 订单状态迁移（unpaid→paid/cancelled→expired）、支付单关联查询 | 不直接写渠道事实 |
| Inventory | 组成功消耗整件（已有能力） | — |
| Audit | 后台退款重试等操作审计 | — |

跨领域协作统一走工作流（`workflows/`）+ 公开端口；**份额生效、组满判定、库存消耗保持各自领域实现**，工作流只编排。

## 2. 统一语言

| 术语 | 英文 | 含义 |
| --- | --- | --- |
| 支付单 | Payment | 一次支付意图与渠道事实的聚合；一个订单可多次发起尝试，但只有一条生效事实 |
| 渠道交易号 | ChannelTransactionId | 微信 transaction_id，渠道事实唯一键 |
| 商户订单号 | OutTradeNo | 提交给微信的 out_trade_no = 订单号（UUID），天然唯一 |
| 支付生效 | ApplyPayment | 预占转已支付 + 组容量/金额更新 + 组满判定的原子流程（幂等） |
| 退款单 | Refund | 五态退款聚合；out_refund_no = `RF-{orderId}-{n}` |
| 迟到支付 | LatePayment | 订单不可生效时收到渠道成功 → 全额自动退款（D008） |
| 未应用支付 | NotAppliedPayment | 支付成功事实已入库但因订单状态无法生效的记录 |

## 3. 聚合与不变量

### 3.1 Payment（聚合根，Payments）

- 属性：`paymentId`、`orderId`（唯一，一单一生效支付单）、`userId`、`amountFen`（= 订单快照 totalAmountFen，渠道提交与核验同源）、`status(created|processing|succeeded|closed|unknown)`、`outTradeNo`（= orderId）、`channelTransactionId`（唯一，可空）、`appliedResult(applied|refunded_not_applied|pending_review|—)`、`prepayId`、`prepayExpiresAt`、`channelPayload`（成功通知解密报文，证据）、`createdAt/updatedAt`。
- 不变量：
  - `amountFen` 来自订单快照，发起与回调核验一致（不一致 → 异常证据 + pending_review）；
  - `succeeded` 必须有 `channelTransactionId` 与成功来源（callback/query）；
  - `channelTransactionId` 全局唯一（渠道事实不重复入账）；
  - 生效应用幂等：applied 状态不可重复应用；
  - 订单不可生效（expired/cancelled/组满/组 failed/截止已过）时不得应用 → 走 D008 全额自动退款。

### 3.2 Refund（聚合根，Payments）

- 属性：`refundId`、`paymentId`、`orderId`、`userId`、`outRefundNo`（`RF-{orderId}-{seq}`，唯一）、`amountFen`（= 实付，全额）、`status(requested|submitted|processing|succeeded|failed)`、`reason(user_cancel|group_failed|late_payment)`、`retryCount`、`channelRefundId`、`failReason`、`createdAt/updatedAt`。
- 不变量：
  - `amountFen == 关联 Payment 实付`（全额退款，含服务费）；
  - `Σ(该 Payment 下 non-failed 退款) ≤ 实付`（应用层断言 + DB 触发器级校验由应用保证）；
  - 五态单向：requested → submitted → processing → succeeded | failed（failed 可人工重试回 submitted）；
  - `succeeded` 仅由渠道回调/查询确认写入；
  - `outRefundNo` 唯一（渠道幂等键）。

### 3.3 渠道事实与状态映射

- 渠道 `trade_state`: SUCCESS→succeeded；REFUND→succeeded（订单存在退款记录）；CLOSED→closed；NOTPAY→processing（继续等）；REVOKED/USERPAYING/PAYERROR→单测覆盖，异常进 pending_review。
- 渠道退款 `status`: SUCCESS→succeeded；PROCESSING→processing；CLOSED→failed（可重试）；ABNORMAL→failed+人工。

## 4. UML 类图

```mermaid
classDiagram
    class Payment {
        paymentId
        orderId
        userId
        amountFen
        status
        outTradeNo
        channelTransactionId
        appliedResult
        prepayId
        prepayExpiresAt
    }
    class Refund {
        refundId
        paymentId
        orderId
        outRefundNo
        amountFen
        status
        reason
        retryCount
    }
    class Order {
        orderId
        status
        totalAmountFen
        units
    }
    class Group {
        groupId
        paidUnits
        paidAmountFen
        status
    }
    class ShareReservation {
        reservationId
        orderId
        status
    }
    class Stock {
        productId
        reservedWholeItems
    }
    Payment "1" --> "1" Order : outTradeNo=orderId
    Payment "1" --> "0..*" Refund : 全额退款
    Order "1" --> "1" ShareReservation
    ShareReservation --> Group
    Group --> Stock : 组成功消耗
```

## 5. 状态图

### Payment

```mermaid
stateDiagram-v2
    [*] --> created : 发起支付（核验订单资格）
    created --> processing : 渠道受理（prepay_id）
    processing --> succeeded : 回调/查询确认 SUCCESS
    processing --> closed : 渠道 CLOSED / 用户取消后关单
    created --> unknown : 外部超时（结果未知）
    unknown --> processing : 查询确认
    succeeded --> [*]
    closed --> [*]
    note right of succeeded : appliedResult 独立记录\napplied / refunded_not_applied / pending_review
```

### Refund

```mermaid
stateDiagram-v2
    [*] --> requested : 取消已支付/组失败/迟到支付
    requested --> submitted : Worker 提交渠道
    submitted --> processing : 渠道受理
    processing --> succeeded : 回调/查询确认
    processing --> failed : 渠道 CLOSED/ABNORMAL/超限
    failed --> submitted : 人工安全重试（审计）
    succeeded --> [*]
```

### 交易闭环总览（订单/预占/组联动）

```mermaid
stateDiagram-v2
    state "unpaid+reserved" as UR
    state "paid+converted" as PC
    state "cancelled+cancelled" as CC
    state "expired+expired" as EE
    [*] --> UR : 下单
    UR --> PC : ApplyPayment（回调/查询，幂等）
    UR --> CC : 用户取消未支付
    UR --> EE : 到期任务
    PC --> [*] : 组满 → success → 库存消耗
    EE --> [*] : 迟到支付 → 全额自动退款
    CC --> [*] : 若已支付后取消 → 退款
```

## 6. 关键时序

### 6.1 发起支付（正常 + 超时未知 + 重复发起）

```mermaid
sequenceDiagram
    participant M as 小程序
    participant C as PayController
    participant I as InitiatePayment 用例
    participant P as PaymentChannelPort
    participant DB
    M->>C: POST /orders/:id/pay
    C->>I: 核验（归属/unpaid/组 open/预占有效）
    alt 已有 processing 且 prepay 未过期
        I-->>C: 返回原 prepay 参数（重复发起幂等）
    else 无有效支付单
        I->>P: 下单（outTradeNo=orderId，金额=快照）
        alt 渠道成功
            I->>DB: Payment processing + prepayId
        else 外部超时
            I->>DB: Payment unknown（结果未知，不认定失败）
            I-->>C: 202 结果未知，请稍后查询
        else 渠道明确失败（如 OUT_TRADE_NO_USED）
            I->>DB: 查单确认（同号可能已成功）
            I-->>C: 按查询结果处理
        end
    end
    C-->>M: 调起支付参数（appId/timeStamp/nonceStr/package/paySign）
    M->>M: wx.requestPayment
    Note over M: 前端回调不可靠——仅触发后端查单
```

### 6.2 支付确认（回调 + 查询竞争 + 幂等）

```mermaid
sequenceDiagram
    participant WX as 微信支付
    participant N as NotifyController
    participant A as ApplyPaymentWorkflow
    participant DB
    WX->>N: POST /payments/v1/notify（密文）
    N->>N: 验签（平台证书/公钥）+ APIv3 解密
    alt 验签失败
        N-->>WX: 4xx {"code":"FAIL"}
    else 验签通过
        N->>DB: 短事务：channel_transaction_id 唯一入账（Payment 事实）
        N-->>WX: 200（先应答）
        N->>A: 异步应用：行锁订单 → 校验可生效（unpaid/预占有效/组 open）
        alt 可生效
            A->>DB: 预占 converted + 组 paid/amount += + 组满判定 + 组成功消耗整件 + 订单 paid（同事务）
        else 不可生效（迟到/已取消/组满）
            A->>DB: appliedResult=refunded_not_applied + 自动全额退款单（D008）
        else 已应用过（重复通知/查询竞争）
            A-->>A: 幂等返回
        end
    end
```

### 6.3 退款（用户取消已支付 → 渠道 → 回调确认）

```mermaid
sequenceDiagram
    participant M as 小程序
    participant C as OrdersController
    participant W as CancelPaidOrderWorkflow
    participant WX as 微信支付
    participant K as Worker
    M->>C: POST /orders/:id/cancel（paid 单）
    C->>W: 组行锁：组 open → 扣容量 + Refund requested + 订单 cancelled（同事务）
    K->>W: 退款驱动：requested → 渠道提交（out_refund_no 幂等）
    W->>WX: POST /v3/refund/domestic/refunds
    WX-->>W: 受理（status=PROCESSING）
    WX->>W: 退款回调（验签解密）
    W->>DB: Refund succeeded（仅此证据可标已退款）
    Note over W: 失败 → 退避重试 → 超限人工队列（审计）
```

### 6.4 失败与恢复（外部超时/DB 失败/重启）

```mermaid
sequenceDiagram
    participant I as InitiatePayment
    participant WX as 微信
    participant DB
    I->>WX: 下单（外部调用，事务外）
    alt 超时
        I->>DB: 短事务记录 unknown
        Note over I,DB: Worker 查询补偿接管
    else DB 失败
        Note over I,DB: 渠道单可能已建——查询补偿按 outTradeNo 对账，不重复下单
    else 成功
        I->>DB: processing
    end
    Note over I,DB: 重启后 Worker 继续（状态全在 DB）
```

## 7. 存储设计（迁移 0011–0013）

| 迁移 | 内容 |
| --- | --- |
| 0011 | `payments`（order_id 唯一、out_trade_no 唯一、channel_transaction_id 唯一、status/applied_result CHECK、金额 CHECK=订单 total、prepay 过期索引） |
| 0012 | `refunds`（out_refund_no 唯一、payment_id 索引、五态 CHECK、reason 枚举、retry_count） |
| 0013 | `payment_channel_events`（回调/查询原始证据：通知 ID、类型、密文、解密摘要，用于异常留痕与审计） |

## 8. 端口（domain/application 声明，adapters/outbound/wechat 实现）

`PaymentChannelPort`：`createJsapiOrder({outTradeNo, amountFen, openid, description, notifyUrl})` → `{prepayId}`；`queryOrderByOutTradeNo(outTradeNo)` → `{tradeState, transactionId?, payerTotal?}`；`closeOrder(outTradeNo)`；`submitRefund({outTradeNo, outRefundNo, refundFen, totalFen, reason})`；`queryRefund(outRefundNo)`；`verifyNotifySignature(headers, rawBody)` → `{valid, decrypted?}`。
配置端口 `PayConfigPort`：mchid/appid/serialNo/私钥/APIv3 密钥/notifyUrl——缺失时渠道端口进入"未配置"状态，发起支付返回 503 `WECHAT_PAY_NOT_CONFIGURED`。
测试替身 `FakePaymentChannelPort` 仅在测试装配注入。
