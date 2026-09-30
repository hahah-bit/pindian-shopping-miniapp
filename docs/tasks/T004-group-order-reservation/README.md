# T004 拼单匹配、份额预占与订单报价

- 功能编号：T004（大任务）
- 目标：用户选商品/份额/地址 → 后端精确匹配拼单组、保护整件库存与份额容量 → 固定报价生成待支付订单 → 小程序查看订单与拼单状态 → 后台查询订单/组/库存预留。**本阶段不接入真实微信支付与退款，不通过模拟付款把订单标记为已支付。**
- 主领域：GroupBuying + Ordering；协作领域：Inventory（整件预留）、Catalog（商品快照）、IdentityAccess（身份与地址归属）、Audit（关键操作）。
- 负责 Agent：当前主 Agent。
- 授权：用户已授权 T004 全部范围；四项业务决策已于 2026-09-30 经用户确认（见 decisions/D001–D005）。
- 修改范围：`backend/src/contexts/{group-buying,ordering,inventory,catalog}`、`workflows`、`bootstrap`、`migrations/0009..0013`、`contracts`、`apps/mini-program`（下单/订单）、`apps/admin-web`（订单/组/库存查询）、`tests`、文档。
- 前置功能：T002（商品/库存/后台身份）、T003（用户/地址/会话）——均已完成并自测通过；Git main 分支已有提交。
- 当前状态：已完成（开发自测通过；D001 边界修订待用户复核；真实微信支付/真机未验证——见 verification.md）。
- 阻塞项：无（四项决策已确认，D005 支付边界按声明执行）。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[实际验收](verification.md)、[决策记录](decisions/)。

## 已确认决策（2026-09-30 用户选定）

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D001 | 报价尾差 | 预占时判定最后单补差：最后单应付 = 整件价 − 组内已生效订单合计；商品/服务费分别可追溯 |
| D002 | 库存生命周期 | 建组预留（available−1/reserved+1 同事务）→ 组成功转消耗 → 截止失败释放；空组不自动解散（有截止时间）；条件更新+唯一键防重 |
| D003 | 配置变化 | 组快照固化（P/份额集合/单位/数量）；改配置只影响新组；下架后已有组继续但禁新预占；组内未支付预占可继续支付 |
| D004 | 时间与数量 | 预占 15 分钟（可配）；截止 = 商品可配 1–168h 默认 24h（组快照固化）；过期判定一律后端 DB 时间；Worker 30s 扫描、重启自恢复；数量展示为"参考数量"非履约依据 |
| D005 | 支付边界 | 领域实现内部 MarkOrderPaid（预占→支付转换、组满判定、库存消耗），不注册 HTTP 端点；生产订单本阶段只能停在 unpaid/cancelled/expired；不做退款/迟到支付/成功后取消 |

## 子功能索引

| 编号 | 名称 | 主领域 | 状态 |
| --- | --- | --- | --- |
| [F013](../../features/F013-share-completeness-matching/README.md) | 份额可完成性与组匹配（纯领域） | GroupBuying | 已完成 |
| [F014](../../features/F014-stock-group-reservation/README.md) | 整件库存预留生命周期 | Inventory | 已完成 |
| [F015](../../features/F015-quote-order-reservation/README.md) | 报价、订单创建与份额预占 | Ordering + GroupBuying | 已完成 |
| [F016](../../features/F016-expiry-deadline-tasks/README.md) | 预占过期与组截止任务 | GroupBuying + Ordering | 已完成 |
| [F017](../../features/F017-mini-order-pages/README.md) | 小程序下单与订单页 | Ordering（用户端） | 已完成 |
| [F018](../../features/F018-admin-order-group-views/README.md) | 后台订单/拼单组/库存预留查询 | Ordering + GroupBuying | 已完成 |

依赖顺序：F013 → F014 → F015 → F016 → F017/F018（并行）→ 联调 → 专项 → 全量。
