# 环境配置与隔离 spec

依据：[大任务规范](../../tasks/T010-local-wechat-simulation/spec.md)；用户授权本地/模拟范围。

增加 APP_ENV=local|simulation|production（默认 local）；微信端点覆盖仅本地/模拟可用，生产必须拒绝。API/Worker 同步收到渠道变量，密钥只读挂载。独立 Compose 项目、卷、数据库、媒体目录；模拟控制面只绑定本机。

验收：TDD：生产拒绝模拟端点与缺配置；Compose 变量传递与隔离冒烟。 失败保持明确错误与未完成；既有公共 API、权限与金额单位不变。待决策：无本地实现阻塞；真实环境单列待验。

