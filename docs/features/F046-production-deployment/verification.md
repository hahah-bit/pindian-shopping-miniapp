# F046 验证
守卫TDD先红Missing expected exception，后2/2通过（含Docker解析生产拓扑、端口/只读密钥、配置先于迁移）。
release:rehearsal:init 构建固定镜像c450c4b36e18，独立pindian-rehearsal-source六服务健康；health CLI通过PG、API、Worker、后台、HTTPS。临时证书作为CA验签HTTPS根200、API ready200、缺失资产404、后台越权401；未关闭TLS验证。
生产APP_ENV守卫使用无真实凭据的拒绝场景；真实微信、服务器、公网TLS部署待验。宿主openssl默认配置缺失，改用本轮生成request.cnf后成功。

## 2026-10-06 跨日重跑修订

- T013首次全量实际执行320项：319通过、1失败，无跳过；失败是T012隔离HTTPS演练的三日临时证书过期（CERT_HAS_EXPIRED）。没有关闭证书校验。
- 新TLS生命周期回归先用恒false实现，因应在剩余一小时内续建的断言失败；实现后1/1通过。覆盖有效期充足、临近到期、已过期、缺失、无效PEM。
- 演练初始化仅续建本地演练证书，并在证书替换后重启既有隔离gateway；生产证书配置不变。
- 随后专项9/10暴露初始化引用不存在的普通镜像标签，而实际构建的是working标签。已按既有镜像隔离规则统一引用，不覆盖封存Git版本。
- 修复后实际执行`node scripts/release/rehearsal-init.mjs`与`npm run test:task:t012`，10/10通过，0失败、0跳过；真实隔离HTTPS、业务/媒体、备份恢复、发布重启及既有兼容版本回退完成。该回退证据只属于T012既有兼容版本对，不表示任意旧应用可兼容新增迁移。
- T013最终全量结果由任务verification单独记录；安卓、微信商户及公网部署仍不在本修订验收范围。
