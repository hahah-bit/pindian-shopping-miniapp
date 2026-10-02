# 生产部署配置 spec

依据：[大任务规范](../../tasks/T012-release-readiness/spec.md)；用户授权本地/模拟范围。

增加生产 Compose、HTTPS 代理模板、只读密钥与运行配置预检。API/Worker 不开放公网端口，数据库仅内网，admin 经 HTTPS；缺少凭据或模拟端点时生产预检失败。保留本地默认启动。

验收：配置隔离采用 TDD；装配后在本地隔离环境生成临时 TLS、构建并验证 HTTPS/健康/路由。 失败保持明确错误与未完成；既有公共 API、权限与金额单位不变。待决策：无本地实现阻塞；真实环境单列待验。


## 实施契约（实现前补充）
生产独立 Compose 仅 gateway 开放 443，API/Worker/PG/admin 内网；image 必须显式版本，WX 文件只读。生产启动先 readConfig，再迁移，再 API；Worker 依赖健康 API，避免迁移竞争。预检 CLI 不输出配置值。HTTPS 使用服务器提供的 fullchain.pem/privkey.pem，演练临时自签证书绝不用于公网。宿主路径、APP_ENV 与 release image 校验失败退出非零。
