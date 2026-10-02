# F046 验证
守卫TDD先红Missing expected exception，后2/2通过（含Docker解析生产拓扑、端口/只读密钥、配置先于迁移）。
release:rehearsal:init 构建固定镜像c450c4b36e18，独立pindian-rehearsal-source六服务健康；health CLI通过PG、API、Worker、后台、HTTPS。临时证书作为CA验签HTTPS根200、API ready200、缺失资产404、后台越权401；未关闭TLS验证。
生产APP_ENV守卫使用无真实凭据的拒绝场景；真实微信、服务器、公网TLS部署待验。宿主openssl默认配置缺失，改用本轮生成request.cnf后成功。
