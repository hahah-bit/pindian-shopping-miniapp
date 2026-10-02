# 本地发布与正式环境交接

## 可重复本地演练

需要Node24、Docker Compose、openssl、tar，本机.env测试PG可用。

1. npm run sim:init；npm run sim:up；测试后台账号用create-admin CLI在模拟环境创建，禁止在正式环境使用demo-super/TestOnly。
2. npm run release:rehearsal:init，生成ignored模拟密钥/临时TLS与固定构建标签。独立HTTPS拓扑按infra/release/README启动source。
3. node scripts/release/package.mjs <已提交Git版本>：仅Git快照构建，生成data/release/packages/<完整SHA>/，source.tar、manifest.json、runtime-images.tar。--no-images仅用于本地基准版省去镜像归档；交付版默认含四个镜像。包中不含.env/运行密钥/未提交协调与T005。
4. 准备两个应用代码与SQL均相同的维护版本包，将baseline/target目录写入data/release/rehearsal-packages.json；npm run test:task:t012会从HTTPS实际业务数据备份、恢复到新随机项目，核对事实/媒体/虚拟渠道后发布、重启、回退，结束清理自建目标。缺少环境/包不得跳过声称通过。
5. 专项通过后npm test，然后health CLI和模拟业务冒烟；日志、状态和备份路径见verification。

## 生产部署（本轮未执行）

服务器填写.env.production（模板根目录），可信TLS证书/微信密钥只读挂载。仅gateway开放443，数据库/API/Worker/admin内网；Compose不与rehearsal/simulation合并。使用真实后台初始账号，密码通过运行环境输入，不进入提交/镜像。

从可信发布包校验manifest各SHA；docker load -i runtime-images.tar，镜像ID与清单核对。解包source.tar到独立发布目录，安装Node脚本运行依赖；在宿主校验时微信密钥路径用宿主可读真实文件，运行Compose固定/run/wechat路径。release:preflight拒绝模拟配置/缺凭据/非HTTPS；该检查不验证真实渠道凭据归属或可用性。

既有项目：先备份到backup/唯一目录，并离机保存、限制运维访问；backup会暂停写入，外部微信回调短时失败依赖渠道重试与已有查单补偿。备份与业务对账结束后选维护窗口执行node scripts/release/publish.mjs <项目> <环境文件> <包目录> backup=<备份目录>，新迁移必须提供匹配当前schema的备份，API先配置检查再迁移（既有advisory lock/逐文件事务）。首次安装在空项目按Compose up启动并验证迁移，不能声称上线验收通过。

脚本以image ID固定API/Worker/admin/PG/gateway，data/release/state记录当前/前版/目标/健康。每次部署后重新验业务与对账；失败不自动修改数据库，不用仅启动旧镜像判断回滚安全。容器健康证明进程/依赖可用，业务任务失败仍须看日志与异常待审核队列。

## 回退与恢复

自动回退仅限应用源码摘要相同、迁移名及SQL摘要完全相同的维护版本；publish末尾rollback参数会验证。业务代码或schema变化都拒绝；需要另行评审兼容或从历史备份恢复到**新**隔离项目，核对支付/退款/订单/履约/库存/通知和媒体，再人工切换入口。备份后新发生的真实支付/退款须先对账补偿，不能用数据库历史快照覆盖微信事实。恢复脚本当前严格限新pindian-rehearsal-restore-*项目名；生产灾备采用新隔离验收项目并人工切换，不自动原地覆盖生产卷。

保留期、离机加密保存与灾备目标需部署时按真实数据/运维条件设置；日志不输出密钥，备份本身仍包含业务数据。TLS续期后重载gateway；删除旧备份/卷前核对恢复与留存要求，本轮不清理用户旧备份。

## 真实环境待验

- 微信appid/secret、商户/支付权限、APIv3密钥、商户私钥/序列号、平台公钥来源与更新、签名和回调URL；核验官方当前文档，不凭模拟结论。
- 真实微信登录、手机号、支付成功/取消/查询/关单、迟到/重复回调与全额退款到账；只在用户后续授权和环境具备时执行。
- 小程序request/upload域名、HTTPS合法证书、开发者工具编译和渲染、真机/体验版上传、后台权限与脱敏、完整业务专项验收。
- 服务器访问策略、资源/告警、备份离机保留和恢复切流量、正式发布/监控。
- D021目前站内通知，外部渠道未配置为skipped；真实订阅消息外发不在本轮，没有声称触达。T005视觉重设计仍排除。

### 一键准备

node scripts/release/rehearsal-prepare.mjs：生成模拟配置/临时TLS，从HEAD和最近40提交中应用/schema相同的维护版本生成固定包，写演练包索引并启动独立source。也可显式传入已确认兼容的Git版本；不存在相同应用版本时明确拒绝。然后npm run test:task:t012，通过后npm test。只针对本地source，不执行正式部署。部署交付仍使用Git快照包；rehearsal:init的工作区演练构建不能替代已提交包。
