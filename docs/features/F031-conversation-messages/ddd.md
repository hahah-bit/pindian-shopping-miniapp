# 会话消息与补取 领域设计

领域认领见 README。复用 Conversation/Message/Ticket 聚合，身份和业务引用使用 ID；金额与发货事实由 Payments/Fulfillment 拥有。本次不引入其他聚合。

统一语言、聚合不变量、事务和失败竞争路径详见 [整改 DDD/UML](../../tasks/T008-customer-service-after-sales/remediation.md)，以及 [整体 DDD](../../tasks/T008-customer-service-after-sales/ddd.md)。本功能对应 RC01–RC04；只实现所属领域及公开端口，跨领域装配归 bootstrap。
