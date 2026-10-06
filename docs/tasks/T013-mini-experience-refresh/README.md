# T013 小程序体验改版与智能客服

- 主领域：商品目录、用户与权限、客服；协作领域：Ordering（仅修复现有下单入口）、媒体。
- 负责 Agent：Codex；授权：2026-10-06 用户要求直接实施。
- 范围：apps/mini-program、Catalog 查询与分类、项目内 Pi 客服适配、演示数据脚本、contracts、专项测试。
- 依赖：T002–T012 的既有真实接口；不改份额、金额、退款、履约规则。
- 状态：已完成（本地开发与开发者工具联调）；阻塞：无本地开发/模型配置阻塞，安卓真机和实际定位授权另验。
- 子功能：[F019 视觉](../../features/F019-mini-storefront-ui/README.md)、[F049 商品发现](../../features/F049-catalog-discovery/README.md)、[F050 定位地址](../../features/F050-address-location/README.md)、[F051 智能客服](../../features/F051-ai-support/README.md)。
- 设计：[DDD](ddd.md)、[规范](spec.md)、[实施](plan.md)。历史 T005 视觉规划由本任务接续，最新方向覆盖原暖白橙红建议。
- 使用：[本地查看与后续真机步骤](usage.md)。当前四项子功能已分别实现并验证，真实微信登录及官方DeepSeek已在开发者工具跑通；最终整体结果以verification为准。
- 验收：[verification](verification.md)。最终专项14/14后全量321/321，失败/跳过均0；原生预览148.5KB，独立界面复查ship。此状态不等于安卓/正式渠道/上线已验收。
