# F018 实际验收记录

日期：2026-09-30。结论：应用层（4/4 先红后绿）与集成层（订单/组查询脱敏断言、order:manage 权限）验收通过；页面浏览器实操随联调（admin 登录后 #/orders 双 Tab）。

## 覆盖

- 订单列表/详情：筛选/分页/脱敏（JSON 无手机号原文、无地址明细；地址仅省市县+掩码）。
- 组列表/详情：进度（paid/reserved/剩余）、快照、成员摘要字段恰为 orderNo/nickname/units/status。
- 无改状态/强制成功/伪造支付接口（控制器仅 GET，代码核对）。
- order:manage 权限：RequirePermissions 标注；403 由守卫保证。
