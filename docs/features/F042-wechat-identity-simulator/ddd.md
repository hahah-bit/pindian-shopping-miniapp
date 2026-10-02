# 登录与手机号模拟 DDD

复用 [大任务模型与 UML](../../tasks/T010-local-wechat-simulation/ddd.md)。无新增业务聚合；复用 /sns/jscode2session、/cgi-bin/stable_token、/wxa/business/getuserphonenumber 的既有装置契约；固定 alice/bob/charlie 测试身份，模拟凭证与真实凭证隔离。既有 /api/mini/v1/auth/login 和 /auth/phone 不变。拒绝/失效/故障不得创建或修改身份事实。

统一语言、状态、事务及跨域边界沿用大任务；装置不得越过领域校验。实际交易/金额/数量/权限事实仍由既有聚合和用例控制。

