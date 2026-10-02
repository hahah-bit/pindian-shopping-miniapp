# F048 实际验收（2026-10-02至10-03，Asia/Shanghai）

- 回退/schema/源码守卫TDD先红Missing expected exception，后通过；工作区标签隔离回归先红相同生产标签，后通过。未降低断言。
- 已提交58537a9与7e9fa12 Git快照包实际构建，清单记录源码/迁移SHA和API/admin/PG/gateway image ID；7e9fa12含离线镜像归档且校验通过。
- 真实HTTPS业务种子→备份DB/媒体/虚拟渠道→新项目恢复逐项一致→发布基准版→发布目标版→API/Worker重启→兼容维护版本回退，既有业务摘要不变。schema缺项/同名SQL变更/应用摘要不同明确拒绝。此为同schema维护回退，不证明数据库降级。
- 首次全量305项303通过2失败：旧HTTP装置并行启动超时、一键准备工作区镜像覆盖封存标签。已整改独立pindian-rehearsal命名空间、加载已校验离线包并核对image ID、runner限制4文件并发，目录筛选/用例/断言不变。修复后重新专项9/9，再全量306/306，0失败0跳过。日志.git/f048-tags-red.log、t012-repaired-special.log、t012-repaired-full.log；失败日志t012-final-full.log保留。
- 一键rehearsal-prepare实际执行成功（.git/t012-fixed-prepare.log）。全量后模拟Docker重新构建五服务健康；身份/手机号及商品→乱序支付→实际Worker履约→通知→看板冒烟通过；HTTPS演练源API/Worker/PG/admin/gateway健康。

本轮仅本地模拟；真实微信到账/触达/真机/体验版/公网部署未执行，详见[runbook](../../tasks/T012-release-readiness/runbook.md)。最终Git快照包在本功能提交后生成，包与备份/配置忽略，不进入Git。
