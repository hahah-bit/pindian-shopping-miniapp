# F008 DDD

纯前端只读展示功能，无后端领域变更：复用 [T002 ddd](../../tasks/T002-catalog-admin-media/ddd.md) 的 Catalog 投影与 MediaAsset URL 设计。前端不持有业务决策（金额/份额/状态以后端为权威，前端仅格式化展示）。

## 前端模型（视图层，无聚合）

- 列表项/详情视图模型直接映射 `MiniProductView` 契约；金额格式化 `fen → "x.xx 元"`（字符串除法，不用浮点参与计算，仅展示拼接）。
- 页面状态机（两页一致）：`loading → ready | empty | error`；详情另有 `notFound`（404 时提示“商品已下架或不存在”）。列表分页追加态 `loadingMore`、无更多态。
- 数据来源：`platform/config.ts` 的 `mode: 'api' | 'mock'`；api 为默认；mock 数据与契约同构并在界面标注“Mock 数据”。切换不改页面结构。

## 与后端的边界

- 只调用公开接口 `GET /api/mini/v1/products*` 与公开图片 URL；不携带 token；不调用 admin 接口。
- 不提供下单/支付按钮；底部固定“拼单购买暂未开放”说明。不展示拼单进度/参与人数/销量（后端无此事实）。
- 参考价文案固定标注“参考价”；`stockStatus=sold_out` 显示“已售罄”徽标且无任何可点击购买元素。

## 不做

不做分享海报、收藏、购物车、骨架屏动画库、分包；不引入 UI 框架（保持原生 WXML/WXSS）。
