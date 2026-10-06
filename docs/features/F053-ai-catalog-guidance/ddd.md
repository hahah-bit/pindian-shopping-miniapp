# F053 DDD

复用[T015领域/UML](../../tasks/T015-ai-catalog-guidance/ddd.md)。AiTurn拥有展示快照与意图，Catalog仍拥有商品事实。新增AiCatalogPort，工作流只调用MiniCatalogQueries公开应用接口；无他域仓储访问、无交易写操作。completed的文本/意图/卡片同lease原子存储，failed清空。分类由工具明确枚举，卡片只来自查询，不由模型结构化URL传入。

真实水果问法修订复用T015精确分类词规范化，仅改变只读检索参数；普通名称/未知词/矛盾分类不放宽，仍无写副作用。
