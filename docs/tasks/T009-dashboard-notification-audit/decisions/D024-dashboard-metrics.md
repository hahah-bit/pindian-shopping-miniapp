# D024 看板指标口径

- **状态**：设计结论（2026-10-02）。需求 §8 只列指标名，未定义时间范围/时区/金额口径；用户指令要求「明确时间范围、时区和金额口径，区分退款申请、受理与到账」。
- **决策**：时区 Asia/Shanghai 自然日（`AT TIME ZONE 'Asia/Shanghai'`），默认基准日=今天、可传 `?date=`；金额整数分；「今日支付金额」按 `orders.paid_at` 且当前 status='paid'（支付后取消/退款的不计）；「平台服务费收入/商品金额」为扣除全额成功退款后的有效口径（退款单笔全额语义，见 T006/T008）；退款三态拆分 requested / submitted+processing / succeeded；拼单成功率=成功/(成功+失败)（不含进行中），无关闭组为 null；平均拼单耗时用组内 `MAX(orders.paid_at)-groups.created_at`（paid_at 是不可变生效事实；groups 无 success_at 列，不引入新列）；客服在线=心跳 60 秒内。全部口径表见 spec §2。
- **理由**：所有指标都能落到既有事实表的不可变字段，避免为看板改交易表；近似口径（会话时长用 updated_at）在 spec 注明。
