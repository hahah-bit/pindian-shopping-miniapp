# 支付退款模拟 spec

依据：[大任务规范](../../tasks/T010-local-wechat-simulation/spec.md)；用户授权本地/模拟范围。

复用 v3 下单/查单/关单/退款契约；金额分、商户订单号与退款号保留。控制面设置渠道状态后发送 RSA 签名、AES-GCM 加密回调；可重放与故障注入。不得直接写业务数据库；站内通知保留 D021。

验收：TDD：查单、签名、密文、处理中/失败/成功退款、重复及迟到回调；真实 API/PG 集成。 失败保持明确错误与未完成；既有公共 API、权限与金额单位不变。待决策：无本地实现阻塞；真实环境单列待验。

控制面沿用F042的令牌：action='payment-state'，outTradeNo+tradeState(SUCCESS/NOTPAY/CLOSED)；action='refund-state'，outRefundNo+status(PROCESSING/SUCCESS/ABNORMAL/CLOSED)；action='failure'，operation(jsapi/query/close/refund/refund-query)+enabled(boolean)；action='notify-payment'/'notify-refund'，业务号+repeats(1–3)+tamper(boolean)。回调只发配置notifyUrl，不接受任意目标；业务状态切换不修改后端数据库。返回callbackStatuses或渠道状态，不冒充真实到账。

金额守恒：下单重放仅同金额/用户接受，改内容409；退款仅已支付订单、整数分、不超过实付，累计有效退款不超过实付；同退款号幂等。商户请求验RSA签名，渠道响应同样签名供既有适配器校验；测试故障明确500。状态默认NOTPAY/PROCESSING，只有显式控制操作改变。

Docker模拟渠道支付退款事实保存在本项目独立simulator-data卷，以原子文件替换持久化；重启恢复，不与主库混用。身份code仍是临时能力，重启失效。损坏文件启动失败，不静默清空渠道事实。
