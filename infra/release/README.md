# 生产拓扑与本地演练
生产使用独立compose.production.yaml，禁止合并模拟override。填写.env.production（模板.env.production.example），密钥目录merchant-private.pem/platform-public.pem与TLS fullchain.pem/privkey.pem只读挂载；文件须由容器node用户可读，源目录仅运维可读。数据库/应用/后台仅内网，443经HTTPS代理；证书续期后重载gateway。
先构建后在宿主运行release:preflight时，将密钥路径填写为宿主真实路径；容器固定路径由Compose提供。preflight仅校验配置，不代表微信联调通过。生产API先预检再迁移，Worker等健康API。镜像须固定提交标签或digest；推荐记录manifest实际image ID。
本地：npm run sim:init → npm run release:rehearsal:init（需要Docker、openssl；随机模拟密钥/临时证书均忽略）→ docker compose --env-file .env.rehearsal.source -p pindian-rehearsal-source -f compose.production.yaml -f compose.rehearsal.yaml up -d --wait。仅127.0.0.1:8443开放，APP_ENV=simulation显式区分；脚本用生成证书作为CA验证HTTPS，绝不关闭TLS校验。生产真实域名/证书/微信/部署待验。
