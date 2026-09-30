# F018 spec

上游：[T004 spec](../../tasks/T004-group-order-reservation/spec.md) §5、AC09/AC12。

## 验收条件

- AC-F18-1 订单列表/详情（order:manage）：筛选/分页；手机号脱敏。
- AC-F18-2 组列表/详情：进度（paid/reserved/剩余）、快照、成员订单摘要（订单号/昵称/单位/状态，无手机号地址）。
- AC-F18-3 库存视图（inventory:manage）：available/reserved/变动记录。
- AC-F18-4 无改状态/强制成功/伪造支付接口（代码审查 + 路由清单核对）。
- AC-F18-5 无权限 403。
