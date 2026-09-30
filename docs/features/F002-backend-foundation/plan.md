# 实施计划

依据：[spec](spec.md)、[DDD](ddd.md)。不采用 TDD，框架装配实现后执行行为验证；不在本轮实现交易实体。

1. 建立 context 边界和纯应用端口，依照契约实现 platform/readiness。
2. NestJS 入口注入 pg probe，限制查询时间、统一错误和 requestId，校验配置。
3. Worker 复用应用检查，写健康时间戳并在退出时关闭连接池。
4. 测试 DB 成功/失败应用路径、真实 HTTP 404/503/请求 ID、配置错误；在 Docker 中验证真实 PG ready 与 Worker 健康。

完成标准对应 AC02/03/04/08，命令随 T001 专项入口；不记录为已完成微信支付或任务调度。
