# T001 框架与 Docker 基础

- 目标：建立可构建、可启动、可检查依赖的前后端骨架及 Docker 本地环境。
- 主领域：平台工程；协作领域：全部限界上下文，仅确立边界，不实现交易规则。
- 负责 Agent：当前主 Agent。
- 授权：用户已确认 TypeScript 后端，并要求落框架和 Docker。
- 修改范围：根工具配置、contracts、backend、apps、infra、tests、scripts、docs；更新过时的 AGENTS 选型与授权描述。
- 前置功能：无；业务需求快照见 `../../requirements/pindian-shopping-mini-program-requirements.md`。
- 状态：已完成（框架源码、自动化验证与 Docker 本地环境范围）。
- 阻塞项：无框架启动阻塞；开发者工具、真机、微信身份与支付不属于本轮已验证能力。

文档：[DDD](ddd.md)、[spec](spec.md)、[plan](plan.md)、[实际验收](verification.md)、[整体架构](../../architecture.md)。

子功能：
1. [F001 工程与契约](../../features/F001-workspace-contracts/README.md)
2. [F002 后端与 Worker](../../features/F002-backend-foundation/README.md)
3. [F003 前端骨架](../../features/F003-frontend-shells/README.md)
4. [F004 Docker 环境](../../features/F004-docker-environment/README.md)
