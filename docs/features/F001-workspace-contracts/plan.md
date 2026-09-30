# 实施计划

依据：[spec](spec.md)、[DDD](ddd.md)、[大任务](../../tasks/T001-platform-foundation/plan.md)。不采用 TDD，原因是工程与传输类型装配。

1. 创建 npm workspaces、根脚本、严格 TypeScript 配置和忽略规则。
2. 在 contracts 保存公开类型与 OpenAPI，只读平台接口不需要业务鉴权。
3. 实现源码依赖方向检查；安装后保存 package-lock。
4. 运行 build/typecheck、架构检查和契约集成验证；任何失败返回非零。验证记录在本目录 verification.md。
