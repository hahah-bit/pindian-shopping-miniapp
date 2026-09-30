# F007 spec

上游：[T002 spec](../../tasks/T002-catalog-admin-media/spec.md) §2（决策 6–7）、§3.3、§4（products/stock 契约）、§6 G6/G7/G9/G10/G12。本文件细化验收条件。

## 接口契约细节

- `POST /api/admin/v1/products`：body `{name, description?, originalPriceFen, wholeQuantity, unit, allowedShareUnits: number[], mainImageId?, detailImageIds?: string[], initialStockWholeItems: number}`；201 返回 AdminProductView。`initialStockWholeItems` 0..100000。引用不存在/非 ready 图片 → 400（事务内商品与库存都不创建）。
- `PATCH /api/admin/v1/products/:id`：同上字段（无 initialStockWholeItems）；全量替换图片关联；200 返回更新后视图。不存在 → 404。
- `GET /api/admin/v1/products`：`status`（可空，枚举过滤）、`keyword`（名称包含，≥1 字符）、分页；按创建时间倒序；每项含 `availableWholeItems`、`mainImageUrl?`、`stockStatus`。
- `POST …/publish`：成功/幂等 200 AdminProductView；条件不满足 409，`details: string[]` 原因清单；不存在 404。
- `POST …/unpublish`：`on_shelf → off_shelf`；已 `off_shelf`/`draft` 幂等 200（draft 不变）。
- `POST …/stock-adjustments`：`{delta? , setTo?, reason, requestId?}`；成功 200 `{stock: StockView, movement: StockMovementView}`；负余额 409 `CONFLICT`；幂等命中 200 当前状态（不新增 movement，`idempotentReplay: true`）；参数二选一冲突/越界 400。
- `GET …/stock-movements`：分页倒序。
- `GET /api/mini/v1/products`、`GET /api/mini/v1/products/:id`：公开；字段 `{id, name, description, mainImageUrl, detailImageUrls[], originalPriceFen, userWholePriceFen, priceFromFen, wholeQuantity, unit, allowedShareUnits: ShareOptionView[]（{units, fractionLabel, quantityText, referencePriceFen}）, stockStatus}`；非上架 404。

写操作均写 OperationLog（`product.created/updated/published/unpublished`、`stock.adjusted`，detail 含关键字段与 requestId）。

## 前端行为（后台商品管理）

- 列表：状态徽标（草稿/已上架/已下架 + 已售罄角标）、主图缩略、名称/价格/单位/库存、筛选（状态下拉 + 关键字）、分页、空态/失败态/重试。
- 表单：前端即时校验与后端一致的规则；份额选项复选（至少 1 项）；参考价实时预览（本地计算仅展示）；保存 201/400/401 反馈，失败保留输入。
- 上架按钮：点击后展示成功或原因清单（`details` 逐条）；重复点击防抖；已上架显示“已上架”禁用。
- 库存：卡片展示当前余额；调整弹层（增量/目标值切换、原因必填、requestId 自动生成）；历史分页。
- 重复提交：保存/调整请求进行中按钮禁用（前端防线；服务端约束与幂等键为权威）。

## 验收条件

- AC-F07-1 参考价：原价 50000 分 → 四种份额参考价 25250/16833/12625/10100；非整除 half-up 正确（单测矩阵覆盖 1 分..上限多组）。
- AC-F07-2 份额数量：10 斤 → 5/3.333/2.5/2（字符串精确）；3 位小数边界（如 0.001）正确。
- AC-F07-3 创建：合法输入生成 draft + 库存 + 首条 movement（集成验证同事务）；引用坏图片 400 且无商品无库存残留。
- AC-F07-4 上架条件：缺主图/库存 0/库存缺记录 → 409 + 原因清单；补齐后成功；重复上架幂等。
- AC-F07-5 下架：成功后 mini 列表消失、详情 404；重复下架幂等。
- AC-F07-6 库存调整：delta/setTo 正常路径留痕；负余额 409；`setTo` 重复无新记录；`delta`+requestId 重复只记账一次；并发两负向调整仅一个成功（行锁验证）。
- AC-F07-7 编辑：全量替换图片关联生效；移除关联后资源仍存在且可删除（联动 F006）。
- AC-F07-8 列表筛选与分页正确（状态、关键字、分页边界）。
- AC-F07-9 金额与数量：所有接口金额为整数分、数量为字符串；无浮点运算（代码审查 + 单测）。
- AC-F07-10 后台全流程实操可用（浏览器）：新建 → 上架 → 调库存 → 筛选查看（AC10 主体）。
