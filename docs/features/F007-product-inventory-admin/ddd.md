# F007 DDD

复用 [T002 ddd](../../tasks/T002-catalog-admin-media/ddd.md) §2.3（Product 与不变量、状态机）、§2.4（Stock/不变量）、§3（ShareOption/ReferencePricing/ShareQuantity/Quantity/Money）、§4（跨上下文事务）、§6.3/6.4（时序）。本文件补充细节，无超出大任务的领域变更。

## 领域服务精确定义（纯函数，整数运算）

- `userWholePriceFen(originalPriceFen) = originalPriceFen + 500`（SERVICE_FEE_FEN 常量，不可配置）。
- `referenceSharePriceFen(originalPriceFen, units) = floor(((originalPriceFen + 500) × units + 30) / 60)`（half-up 到分）。示例：原价 50000 分 → 1/2=25250、1/3=16833、1/4=12625、1/5=10100。
- `shareQuantityText(wholeQuantity, units)`：`totalMilli = wholeQuantity×1000`（由 Quantity 值对象保证 ≤3 位小数），`milli = floor((totalMilli×units + 30)/60)`，输出 ≤3 位小数字符串（去尾零）。示例：10 斤 → 1/2=5、1/3=3.333、1/4=2.5、1/5=2。
- 两者均标注“参考展示”；支付报价与尾差分摊在后续交易任务定义，本规则不作为计费依据。

## Product 校验规则（创建与编辑共用）

- name：1..60 字符；description：0..2000；unit：1..10 字符；originalPriceFen：正整数 ≤ 99,999,999 分；wholeQuantity：Quantity（>0、≤3 位小数、≤999999999）；allowedShareUnits：{30,20,15,12} 非空子集去重。
- 图片：mainImageId 可空（上架时必须）；detailImageIds ≤ 9、无重复；所有图片必须 ready 且（创建时不存在商品引用冲突）。同一 mediaId 不得同时出现在 main 与 details。
- 编辑采用全量替换语义（未提供图片字段视为清空——前端始终提交完整表单；契约文档明示）。

## 上架条件（publish 汇总原因清单）

1. 基础字段全部合法（创建/编辑时已保证，此处兜底）；
2. mainImageId 已设置且资源 ready；
3. 库存记录存在且 `availableWholeItems > 0`。
任何一条不满足 → 409 `PRODUCT_NOT_PUBLISHABLE`，`details` 为原因数组（中文，可直接展示）。已 `on_shelf` 时幂等成功。

## Inventory 细节

- 初始化：创建商品事务内 `available = initialStockWholeItems`（0..100000 整数），写入首条 movement（delta = 初始值，reason 固定“创建商品初始化库存”）。
- 调整：`delta ∈ [-1e6,1e6]` 非零 或 `setTo ∈ [0,1e6]`（二选一，同给 400）；reason 1..200 字符；requestId 可选 UUID。行锁（`SELECT … FOR UPDATE`）内计算 `resultingAvailable`，<0 → 409；`(product_id, request_id)` 部分唯一索引去重（冲突返回当前状态）；数据库 CHECK `available >= 0` 兜底。
- `reserved_whole_items` 恒 0，仅建列预留；任何用例不得写入。

## 工作流

- `CreateProductWorkflow`：TransactionRunner 内 ProductRepository.save + StockRepository.initialize；任一失败整体回滚（G 商品与库存同生同灭）。
- `PublishProductWorkflow`：查库存可用性 → Catalog publish（条件校验）。两步非原子：上架成功瞬间库存被调整为 0 是合法序列（展示已售罄），不产生数据损坏；当前无并发交易，竞争影响仅限展示。

## 查询投影

- Admin 列表/详情：含库存余额、主图缩略、状态、变动入口；状态筛选 `draft|on_shelf|off_shelf`；关键字按名称 ILIKE。
- Mini 投影（只读，由 Catalog 用例产出，不经 workflows）：仅 `on_shelf`；字段见 T002 spec §4；`stockStatus = available>0 ? 'available' : 'sold_out'`；`priceFromFen = min(参考价)`。
