# F007 plan

依据：[spec](spec.md)、[DDD](ddd.md)、[T002 plan](../../tasks/T002-catalog-admin-media/plan.md) S5。

## 测试策略

采用 TDD（领域与应用层）：金额/份额/数量计算、上架条件、状态迁移、库存非负/幂等/并发属 AGENTS 2.2.1 默认 TDD 范围。测试文件：`tests/task-suites/t002/product-domain.test.mjs`、`product-application.test.mjs`（内存仓储）；行锁/唯一索引/事务回滚在 `integration-db-http.test.mjs` 用真实 PG 验证。管理后台页面非 TDD：实现后走浏览器冒烟（联调阶段）。通过标准：单测全绿 + 集成断言通过 + 浏览器实操。

## 步骤

- [ ] P1 迁移 0004（products/product_images：状态 CHECK、份额数组、部分唯一 main、(product,media) 唯一）与 0005（stocks/stock_movements：CHECK ≥0、(product,request_id) 部分唯一、变动结果 CHECK）。
- [ ] P2 contracts：AdminProductView/AdminProductListItem/StockView/StockMovementView/MiniProductView/ShareOptionView + 请求类型 + OpenAPI。
- [ ] P3 TDD 领域：Quantity/Money 校验、ReferencePricing/ShareQuantity 矩阵、Product 工厂与不变量、publish 条件原因清单、状态迁移守卫。测试先行。
- [ ] P4 TDD 应用：CreateProduct/UpdateProduct/ListAdminProducts/GetAdminProduct + 图片关联校验（引用 ready、重复、上限）；Inventory InitializeStock/AdjustStock（负余额/幂等/二选一）；mini 投影 ListPublishedProducts/GetPublishedProduct（仅 on_shelf、sold_out 推导）。内存仓储测试先行。
- [ ] P5 工作流：CreateProductWorkflow（事务回滚验证：假仓储抛错 → 两聚合均无）、PublishProductWorkflow（条件编排）。
- [ ] P6 适配器：pg ProductRepository（行组装：images、份额数组）、StockRepository（FOR UPDATE、幂等冲突捕获）、pg 事务 runner。
- [ ] P7 入口：AdminProductsController、AdminStockController、MiniProductsController；错误映射（409 details）。
- [ ] P8 前端：api-client 商品/库存方法；ProductListView、ProductFormView（含上传/主图/排序/份额/参考价预览）、StockDialog、MovementHistory；App 路由接入。
- [ ] P9 验证：单测证据 → 集成（G6/G7/G9/G10/G12 全路径）→ 浏览器实操；回写 verification.md。

## 完成标准

spec AC-F07-1..10 满足；T002 plan S5 勾选；金额无浮点、库存无透支、上架条件不可绕过。
