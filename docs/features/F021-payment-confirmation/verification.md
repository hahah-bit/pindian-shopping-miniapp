# F021 实际验收记录

日期：2026-10-01。结论：单元层验收通过（7/7 先红后绿）；PG 集成随 t004/t006 集成测试。

## 覆盖与修复

- 正常确认（预占转换、组金额、订单 paid、applied 幂等）、组满 success+消耗、重复通知幂等、金额不符 pending_review、迟到支付全额退款（订单 expired / 组 success 后）、预占过期兜底退款。
- **关键修复**：预占转支付误用 remainingCapacity 检查（新预占语义）导致已预占份额永远无法生效——修正为转换语义（reserved≥units 由 withPaidUnits 防护），paidUnits=0 允许（纯金额更新场景）。
- 假件 Repository 保存语义修正（save 替换聚合）。
