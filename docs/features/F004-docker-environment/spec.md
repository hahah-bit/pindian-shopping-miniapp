# 功能规范

覆盖 AC07、AC08、AC10：Compose 提供 PostgreSQL/API/Worker/后台，具备健康检查和依赖就绪条件，数据库命名卷，默认所有发布端口绑定本机。Redis 为可选 cache profile，本轮应用不依赖它。构建不复制密钥，运行密码从本地 .env 注入；不得用删除卷的方式完成普通停止。Docker 引擎或网络不可用必须记录未验证，不能宣称已启动。
