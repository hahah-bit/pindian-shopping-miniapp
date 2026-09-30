# 实施计划

依据：[spec](spec.md)、[DDD](ddd.md)。不采用 TDD，以配置解析、实际容器启动及 HTTP 冒烟验收。

1. 准备 backend/admin 多阶段构建、Nginx 代理和 PostgreSQL/Worker/API/admin Compose。
2. .env.example 描述变量，初始化本地 .env 时生成随机数据库密码；不将 .env 加入仓库或镜像。
3. `docker compose config --quiet`，`docker compose up -d --build --wait`，检查健康和代理。
4. `npm run smoke:docker` 检查实际 ready、平台契约、后台资产与 Worker；通过后执行项目全量入口。

保留数据库卷，不清理其他项目容器。若 Docker 镜像下载或引擎无法就绪，记录错误与未完成项并保持可复现启动说明。
