# 私有图片与业务卡片 领域设计

领域认领见 README。复用 Conversation/Message/Ticket 聚合，身份和业务引用使用 ID；金额与发货事实由 Payments/Fulfillment 拥有。本次不引入其他聚合。

统一语言、聚合不变量、事务和失败竞争路径详见 [整改 DDD/UML](../../tasks/T008-customer-service-after-sales/remediation.md)，以及 [整体 DDD](../../tasks/T008-customer-service-after-sales/ddd.md)。本功能对应 RC09；只实现所属领域及公开端口，跨领域装配归 bootstrap。

私有附件第一版以 PostgreSQL bytea 保存，单图 ≤5 MiB，metadata 与内容原子插入，不使用商品公开图片地址。图片检查能力通过应用端口复用，由 bootstrap 注入；私有读取返回受鉴权保护的二进制，客户端带 Bearer 下载到临时文件/Blob。资源属于会话，转接后的负责客服及会话用户可读。客户端发送只传附件 ID，服务端再次确认附件会话与发送会话相同。
