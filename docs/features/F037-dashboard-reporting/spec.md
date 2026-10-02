# F037 Spec

引用 [T009 spec](../../tasks/T009-dashboard-notification-audit/spec.md) §2 指标口径、§3.1 契约、§5 页面状态、§6 A1/A2/A3；本文件只补子功能细节。

## 端点
- `GET /api/admin/v1/reporting/overview?date=`（`reporting:view`）：总览 11 项 + 退款三态 + 商品 9 项 + `generatedAt`/`date`。
- `GET /api/admin/v1/reporting/customer-service?date=`（`reporting:view_cs`）：客服 10 项 + 超时计数。

## 行为细节
- `date` 校验 `YYYY-MM-DD` 且为合法日历日，否则 400 VALIDATION_FAILED；缺省=今日（Asia/Shanghai）。
- 每个端点单连接多语句只读执行；`successRate`/`ticketResolveRate` 分母 0 → `null`；时长取整分钟，无样本 `null`。
- `agentLoad` 只含已分配会话，附 `displayName`；已禁用账号名称照实返回。
- 前端页面状态见 T009 spec §5（正常/加载/空/失败/无权限；cs_supervisor 仅客服区块）。

## 验收条件
- A1.1 指标逐项与手工 SQL 一致（含跨 Asia/Shanghai 日界数据归正确基准日）。
- A1.2 金额全为整数分；比率与时长口径见 T009 spec §2。
- A2 空库/空基准日 → 0 与 null，200。
- A3 权限矩阵：super_admin 两端点 200；cs_supervisor 仅客服端点 200；cs_agent/catalog_admin 403；未认证 401。
