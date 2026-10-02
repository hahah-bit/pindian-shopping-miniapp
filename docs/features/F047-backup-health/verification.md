# F047 验证
2026-10-02：TDD隔离守卫先红Missing expected exception、模拟渠道清单先红“备份清单非法”，后4/4通过（3守卫/校验 + 1真实恢复场景），0失败0跳过。日志.git/f047-red.log、f047-channel-red.log、f047-final.log。
两次真实隔离恢复通过；source经HTTPS形成商品/图片/支付/履约/通知，停止API/Worker（模拟模式含simulator），PG custom dump与媒体/模拟渠道tar及SHA清单，finally重启原运行服务。新随机pindian-rehearsal-restore-*恢复，逐表count/行摘要、迁移28项、媒体文件SHA一致；模拟虚拟SUCCESS事实保留，5项业务服务健康。重复恢复已有目标明确拒绝，篡改dump在创建目标前拒绝。测试结束仅清理验证过前缀的自建目标卷，源与备份保留。
备份含业务数据，应按运维runbook保护；不含运行.env/密钥。正式服务器备份保留周期、离机保存、真实渠道与恢复后流量切换待环境验收。
