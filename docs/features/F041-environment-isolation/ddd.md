# 环境配置与隔离 DDD

复用 [大任务模型与 UML](../../tasks/T010-local-wechat-simulation/ddd.md)。无新增业务聚合；增加 APP_ENV=local|simulation|production（默认 local）；微信端点覆盖仅本地/模拟可用，生产必须拒绝。API/Worker 同步收到渠道变量，密钥只读挂载。独立 Compose 项目、卷、数据库、媒体目录；模拟控制面只绑定本机。

统一语言、状态、事务及跨域边界沿用大任务；装置不得越过领域校验。实际交易/金额/数量/权限事实仍由既有聚合和用例控制。

