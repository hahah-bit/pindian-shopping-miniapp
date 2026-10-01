# F022 实际验收记录

日期：2026-10-01。结论：单元层验收通过（7/7 先红后绿）；PG 集成随 t006 集成测试。

## 覆盖

- 取消已支付订单：容量即扣（deduct 调用断言）、Refund requested 全额含服务费、订单 cancelled。
- 组已成功后取消 → ORDER_NOT_CANCELLABLE。
- 退款驱动：requested → submitted → 渠道提交 → processing；out_refund_no 幂等键。
- 回调确认：SUCCESS 证据 → succeeded；无证据不标已退款。
- 累计上限：REFUND_EXCEED_LIMIT。
- 人工重试：仅 failed；审计 refund.retry；无效 ID → VALIDATION_FAILED。

## 修复记录

- 领域补 cancelPaid（paid → cancelled）；RefundDriver 补 markSubmitted 步骤（requested → submitted → 渠道）。
- 无效 UUID 退款 ID → VALIDATION_FAILED（前端/入口参数校验语义）。
