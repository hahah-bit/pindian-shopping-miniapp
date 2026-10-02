# 私有图片与业务卡片 实施计划

晚于 [spec](spec.md)，复用 [DDD](ddd.md) 与 [整体整改 plan](../../tasks/T008-customer-service-after-sales/remediation.md)。

- 修改目录：backend/src/contexts/customer-service，覆盖 RC09。
- 涉及权限、状态、幂等、并发、数量/资金规则采用 TDD；先目标行为失败，再实现通过。页面布局直接实现后做接口及交互冒烟。
- 存储调整追加 PostgreSQL 迁移，保留历史快照；跨领域经公开端口，事务使用同一 sessionTx。
- 相关子功能测试通过后接入前端；任务收尾先 T007/T008 专项，再 npm test 全量、Docker 冒烟；真实微信/真机另记未验证。
- 完成标准：指定验收真实通过，回写 verification；失败或待决策保留真实状态。

## 实施状态

本轮所属步骤已完成，具体修改、适用验收及实际验证见 [verification](verification.md)；资金权限由F036/D020落实。专项、全量及隔离Docker均已实跑通过，真机未验。
