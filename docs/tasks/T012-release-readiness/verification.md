# T012 整体验收

本地范围完成，验收跨2026-10-02/10-03（上海）。

| 验证顺序 | 实际结果 |
| --- | --- |
| 修复后npm run test:task:t012 | 9/9，无失败/跳过，.git/t012-repaired-special.log |
| 随后npm test | 306/306，无失败/跳过，.git/t012-repaired-full.log |
| 全量后整体冒烟 | 模拟五服务重建健康，身份/手机号与实际业务/Worker冒烟通过；HTTPS六服务健康检查通过 |

F046生产拓扑/HTTPS/隔离：[记录](../../features/F046-production-deployment/verification.md)；F047真实DB/媒体/虚拟渠道恢复：[记录](../../features/F047-backup-health/verification.md)；F048Git快照/离线包/发布重启/兼容回退：[记录](../../features/F048-release-rollback/verification.md)。首次全量两项装置失败及整改如实保留于F048，不当作通过。

固定镜像与迁移/源码摘要守卫运行；不兼容路径拒绝原地回退，实际备份恢复到新项目，不用旧应用启动冒充数据库回滚。交接与真实环境待验见[runbook](runbook.md)。本轮未真实付款、未外发订阅消息、未部署公网、未上传体验版；微信工具安装但CLI安全端口关闭，渲染/真机未验。
