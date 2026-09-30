# F008 小程序商品列表与详情

- 功能编号：F008
- 目标：原生小程序接入真实后端，展示上架商品列表与详情（图片、价格、份额参考、库存状态），状态齐备且不虚构业务数据。
- 主领域：Catalog（用户端只读投影）；协作领域：无写协作（媒体读取经公开 URL）。
- 负责 Agent：当前主 Agent。
- 所属大任务：[T002](../../tasks/T002-catalog-admin-media/README.md)；整体设计见 [T002 ddd](../../tasks/T002-catalog-admin-media/ddd.md)、[T002 spec](../../tasks/T002-catalog-admin-media/spec.md) §3.4/§5。
- 修改目录：`apps/mini-program/miniprogram/{platform,features/catalog}`、`apps/mini-program/project.config.json`（不换框架/不换 AppID 方式）、`tests/task-suites/t002`（页面注册契约）。
- 前置功能：[F007](../F007-product-inventory-admin/README.md)（接口与数据就绪）。
- 当前状态：已完成（代码与接口层；开发者工具/真机未验证，见 verification.md）。
- 阻塞项：微信开发者工具/真机验证依赖用户环境，如实记录未验证项。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[验收](verification.md)。

## 状态记录

- 2026-09-30：完成实现与接口层验收。
