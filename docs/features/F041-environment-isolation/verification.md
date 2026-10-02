# F041 验证（2026-10-02）

配置边界TDD：.git/f041-red.log中3项先红；backend构建后4/4通过（追加Compose同配置/只读挂载/端口隔离）；T003专项31/31，无跳过，登录适配器改为配置实例端点而非模块全局。

npm run sim:init已执行；再次初始化保留已有.env.simulation和密钥。测试密钥及配置不入Git。APP_ENV默认local，production拒绝端点覆盖与缺失凭据/非HTTPS域名；模拟环境与主库分别配置。完整启动依赖F042/F043模拟服务，任务整体验收留待其完成。
