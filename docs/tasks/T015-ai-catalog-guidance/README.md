# T015 智能客服商品导购

- 目标：识别推荐/介绍/找商品意图，真实查询商品并展示可点击详情卡片。
- 主领域：CustomerService；协作：Catalog公开查询、IdentityAccess本人会话；负责Agent：Codex。
- 范围：backend客服/Pi/查询装配、contracts、小程序聊天、迁移及测试；依赖T013/T014。
- 状态：已完成本轮本地范围；最终专项24/24、全量339/339，失败/跳过0；真实DeepSeek推荐/介绍/自然需求/分类及开发者工具卡片/详情/恢复通过，独立界面审查与设计记录完成；安卓仍单独待验。
- 子功能：[F053](../../features/F053-ai-catalog-guidance/README.md)，整体[DDD](ddd.md)/[spec](spec.md)/[plan](plan.md)。
- 实际结果与限制：[verification](verification.md)；Git提交以`feat(t015-ai): 增加商品意图识别与可点击导购卡片`定位。
