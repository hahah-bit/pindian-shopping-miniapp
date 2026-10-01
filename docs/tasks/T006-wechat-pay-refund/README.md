# T006 微信支付、退款与交易闭环

- 功能编号：T006（大任务）
- 目标：小程序下单后调起微信支付 → 后端确认支付事实（回调验签 + 查询补偿）→ 份额生效与拼单状态更新；允许的取消/拼单失败 → 全额退款 → 渠道结果确认 → 两端查询；异常支付退款查询补偿、重试与人工处理。**真实渠道验证依赖商户配置与用户测试环境，缺少条件时完成可验证部分并如实记录。**
- 主领域：Payments；协作领域：GroupBuying（份额生效/组成功）、Ordering（订单状态）、Inventory（组成功消耗）、IdentityAccess（用户身份）、Audit（后台退款操作）。
- 负责 Agent：当前主 Agent。
- 授权：用户已授权 T006 全部范围（设计/实现/自测/修复/本地提交）。
- 修改范围：`backend/src/contexts/payments`、`ordering`、`group-buying`、`workflows`、`bootstrap`、`worker`、`migrations/0011..0014`、`contracts`、`apps/mini-program`（支付/退款页）、`apps/admin-web`（支付退款查询）、`tests`、文档。
- 前置功能：T002/T003/T004（均已完成自测，74438ab）。
- 当前状态：已完成（开发完成、自测通过、未独立最终验收；Docker 运行时与 DB 集成已验证；真实商户渠道验证待用户配置——见 verification.md）。
- 阻塞项：**真实商户配置缺失**（WX_APPID 留空、无 mchid/商户私钥/APIv3 密钥/证书序列号）→ 真实渠道调用不可执行；实现为可配置端口 + 缺配置明确报错，不伪造渠道成功。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[实际验收](verification.md)、[决策记录](decisions/)（D006–D010 已确认）。

## 子功能索引

| 编号 | 名称 | 主领域 | 状态 |
| --- | --- | --- | --- |
| [F020](../../features/F020-payment-aggregate-channel-port/README.md) | 支付单聚合与渠道端口 | Payments | 已完成 |
| [F021](../../features/F021-payment-confirmation/README.md) | 支付确认（回调/查询/生效/迟到支付） | Payments + GroupBuying | 已完成 |
| [F022](../../features/F022-refund-flow/README.md) | 退款流程（取消已支付/组失败/五态） | Payments + GroupBuying | 已完成 |
| [F023](../../features/F023-worker-compensation/README.md) | Worker 补偿任务（查询/退款驱动） | Payments | 已完成 |
| [F024](../../features/F024-mini-pay-refund-pages/README.md) | 小程序支付与退款页 | Payments（用户端） | 已完成 |
| [F025](../../features/F025-admin-pay-refund-views/README.md) | 后台支付/退款查询与重试 | Payments + Audit | 已完成 |

依赖顺序：F020 → F021 → F022 → F023 → F024/F025（并行）→ 联调 → 专项 → 全量。

## 微信官方接口核验记录（2026-10-01，来源 pay.weixin.qq.com v3 商户文档）

| 能力 | 接口 | 关键约束 |
| --- | --- | --- |
| 小程序下单 | POST `https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi` | 请求体 appid/mchid/description/out_trade_no(6-32 唯一)/notify_url/amount.total(分)/payer.openid 必填；time_expire 可选；返回 prepay_id（2 小时有效）；错误码 OUT_TRADE_NO_USED/SIGN_ERROR/FREQUENCY_LIMITED/SYSTEM_ERROR(可同参重试) 等 |
| 调起支付 | wx.requestPayment | 参数 appId/timeStamp(秒)/nonceStr/package=`prepay_id=xxx`/signType=RSA/paySign（RSA 签名，用商户私钥）；**前端回调不可靠，以后端查单与回调为准** |
| 支付回调 | 商户 notify_url | 头 Wechatpay-Serial/Signature/Timestamp/Nonce；体 resource.ciphertext 用 **APIv3 密钥 AEAD_AES_256_GCM** 解密；解密字段 out_trade_no/transaction_id/trade_state/amount.total/payer.openid/success_time；**验签通过 HTTP 200/204 无需报文**，失败 4xx/5xx + `{"code":"FAIL"}`；**重复通知必须幂等**；未应答按 15s…6h 重试 15 次 |
| 查询订单 | GET `/v3/pay/transactions/out-trade-no/{no}?mchid=` | trade_state 枚举 SUCCESS/REFUND/NOTPAY/CLOSED/REVOKED/USERPAYING/PAYERROR；amount.payer_total 为用户实付 |
| 申请退款 | POST `/v3/refund/domestic/refunds` | out_trade_no 或 transaction_id 二选一；out_refund_no 商户唯一（**同号重复请求只退一笔，幂等**）；amount.refund ≤ amount.total；status 枚举 SUCCESS/CLOSED/PROCESSING/ABNORMAL；成功响应仅代表受理，结果以回调/查询为准 |
| 退款查询 | GET `/v3/refund/domestic/refunds/{out_refund_no}` | 同 status 枚举 |
| 退款回调 | 退款 notify_url | 同支付回调验签/解密模式 |

配置需求（仅模板进 Git）：`WX_PAY_MCHID`、`WX_PAY_SERIAL_NO`（商户证书序列号）、`WX_PAY_PRIVATE_KEY_PATH`（商户 API 私钥文件路径）、`WX_PAY_APIV3_KEY`、`WX_PAY_NOTIFY_URL`。真实密钥不进入 Git、响应或日志。
