# 生产拓扑与本地演练
生产使用独立compose.production.yaml，禁止合并模拟override。填写.env.production（模板.env.production.example），密钥目录merchant-private.pem/platform-public.pem与TLS fullchain.pem/privkey.pem只读挂载；文件须由容器node用户可读，源目录仅运维可读。数据库/应用/后台仅内网，443经HTTPS代理；证书续期后重载gateway。
先构建后在宿主运行release:preflight时，将密钥路径填写为宿主真实路径；容器固定路径由Compose提供。preflight仅校验配置，不代表微信联调通过。生产API先预检再迁移，Worker等健康API。镜像须固定提交标签或digest；推荐记录manifest实际image ID。
本地：npm run sim:init → npm run release:rehearsal:init（需要Docker、openssl；随机模拟密钥/临时证书均忽略）→ docker compose --env-file .env.rehearsal.source -p pindian-rehearsal-source -f compose.production.yaml -f compose.rehearsal.yaml up -d --wait。仅127.0.0.1:8443开放，APP_ENV=simulation显式区分；脚本用生成证书作为CA验证HTTPS，绝不关闭TLS校验。生产真实域名/证书/微信/部署待验。

备份：node scripts/release/backup.mjs 源项目 环境文件 backup/唯一目录 [rehearsal]。暂停API/Worker写入，在同一窗口备份DB+媒体；模拟模式额外暂停/保存虚拟渠道。失败finally恢复原运行状态，只有完整manifest可恢复。
恢复：node scripts/release/restore.mjs pindian-rehearsal-restore-唯一后缀 目标环境文件 backup/目录 [rehearsal]。仅新隔离项目，已有容器/卷即拒绝；不覆盖源库。校验失败不创建目标，恢复中失败保留目标供检查（不可盲目重跑覆盖）。正式恢复前离机复制备份并在目标隔离网络验数据，确认后人工切换域名/入口。
健康：node scripts/release/health.mjs 项目 环境文件 [rehearsal]。Worker心跳、DB就绪、API/后台/gateway容器健康；模拟额外CA验签HTTPS。
