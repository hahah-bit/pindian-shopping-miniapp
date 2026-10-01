# F020 实际验收记录

日期：2026-10-01。结论：单元层验收通过（7/7 先红后绿）；pg 适配器随集成验证。

## 覆盖

- 正常发起（金额同源快照、RSA 调起参数）、prepay 2h 幂等复用、越权 404、不可支付三态、未配置 503 不建单、外部超时 unknown、同号已用查单恢复（SUCCESS→succeeded / NOTPAY→processing 占位）。

## 修复记录

- OrderForPaymentState 平铺视图对齐（无 state 包裹）；FakeGroupRepository 补 isJoinable；build() 去 overrides 展开错位；createUnknown 补 prepayId 占位；prepayUsable 由 getter 改方法并排除 pending-query。
