# Pi 智能客服实施

T014修订：先用实际页面装置验证缓存Tab再次进入及异步身份竞争，保留业务红灯；再增加onShow/onHide、loading版本、发送版本和分页身份保护，改旧入口为switchTab。新状态投影交给F052组件；专项test:task:t014后npm test，记录独立原生渲染与待验项。不改后端或持久结构。

SDK 的公开子路径只导出 ESM；后端 TypeScript 编译配置采用 NodeNext 模块解析（项目既定 Node24），既有 Nest 源码仍编译为 CommonJS，Pi 适配器使用原生动态 import，不通过 coding-agent 读取全局工具/配置。类型导入明确 import resolution-mode。Node16 解析不支持现有 Nest ESM 的 Node24 require 互操作，因此未采用。此装配变更需全量构建和测试验证。

依赖 [DDD](ddd.md)、[spec](spec.md)，覆盖 AC05/06。

采用 TDD：认证隔离、幂等、同键冲突、并发租约、限流、异常和重启恢复；真实 Pi Agent + 受控模型 HTTP 验证，真实模型单独联调；凭据已按用户授权配置在忽略的 .env。

1. 定义公开契约、输入限制、错误码与失败状态。
2. 按 backend/src/contexts/customer-service、bootstrap、contracts、apps/mini-program/miniprogram/features/ai-support、Compose 实施端口/适配器/页面，保持领域依赖方向。
3. 存储与环境：迁移0030增加独立轮次表及唯一键/用户索引；认领与完成短事务，模型 HTTP 不持有事务。默认30秒模型超时、租约45秒、每分钟10次、最近20条/8000字符，失败可同键重试；新 Agent 每次请求重建本人上下文。GET before 本人轮次UUID/pageSize20最多50；POST UUID/text≤1000，401/400/409/429/502/503/504准确；空模型配置保留人工客服正常。
4. 执行 tests/task-suites/t013 对应功能测试及真实接口冒烟；整体专项通过后 npm test。
5. 记录实际结果和未验项，精确暂存并中文 feature 提交，继续下一功能。
# T015导购修订计划（实现前）

本轮按[F053 plan](../F053-ai-catalog-guidance/plan.md)实施并复用T015验收。只读工具及元数据采用TDD，先行为失败；旧空tools断言改为唯一search_catalog权限，不减少原鉴权/隔离/限流断言。0031兼容默认，先专项后全量。
