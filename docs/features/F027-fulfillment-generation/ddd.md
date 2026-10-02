# F027-fulfillment-generation 领域索引

复用Fulfillment的Quantity分配服务、FulfillmentOrder聚合和T007整体DDD；不新增交易聚合。负责Codex，修改所属Fulfillment、工作流及销售资格公开端口。D019实现前领域分析/spec/plan见 [D019](../../tasks/T007-fulfillment-shipment/decisions/D019-positive-allocation.md)，本文件仅验收后的模型索引补充。

不变量：60单位精确份额，floor后按创建顺序补余，每订单数量>0；数量总和守恒。销售资格遍历所有允许有序满额组合；历史异常组不改快照，不部分生成。按组事务生成，持久化异常记录不拥有支付权；F036批准退款产生停止记录，组锁内检查，仍按原全组分配后跳过停止订单。

类图、生成状态与失败/并发时序复用 [T007 DDD](../../tasks/T007-fulfillment-shipment/ddd.md)，审批事务及失败时序见 [F036 DDD](../F036-reviewed-after-sales/ddd.md)。
