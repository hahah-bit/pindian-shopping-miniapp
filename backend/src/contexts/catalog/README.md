# 商品目录上下文

状态：已规划，业务尚未实现。本轮只认领领域边界。

候选模型与职责：Product、ProductSpec、SalePolicySnapshot；商品发布、规格与销售规则。

目录：domain 保存聚合/值对象/规则；application 按功能分目录并声明 ports；adapters/inbound 和 outbound 分别接入协议与外部能力。具体功能先在 docs/features 落 DDD/spec/plan，不能绕过仓储边界或把 NestJS/pg 引入领域。
