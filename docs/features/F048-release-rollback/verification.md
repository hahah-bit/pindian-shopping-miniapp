# F048 实际验收（2026-10-02至10-03，Asia/Shanghai）

- 回退/schema/源码守卫TDD先红Missing expected exception，后通过；工作区标签隔离回归先红相同生产标签，后通过。未降低断言。
- 已提交58537a9与7e9fa12 Git快照包实际构建，清单记录源码/迁移SHA和API/admin/PG/gateway image ID；7e9fa12含离线镜像归档且校验通过。
- 真实HTTPS业务种子→备份DB/媒体/虚拟渠道→新项目恢复逐项一致→发布基准版→发布目标版→API/Worker重启→兼容维护版本回退，既有业务摘要不变。schema缺项/同名SQL变更/应用摘要不同明确拒绝。此为同schema维护回退，不证明数据库降级。
- 首次全量305项303通过2失败：旧HTTP装置并行启动超时、一键准备工作区镜像覆盖封存标签。已整改独立pindian-rehearsal命名空间、加载已校验离线包并核对image ID、runner限制4文件并发，目录筛选/用例/断言不变。修复后重新专项9/9，再全量306/306，0失败0跳过。日志.git/f048-tags-red.log、t012-repaired-special.log、t012-repaired-full.log；失败日志t012-final-full.log保留。
- 一键rehearsal-prepare实际执行成功（.git/t012-fixed-prepare.log）。全量后模拟Docker重新构建五服务健康；身份/手机号及商品→乱序支付→实际Worker履约→通知→看板冒烟通过；HTTPS演练源API/Worker/PG/admin/gateway健康。

本轮仅本地模拟；真实微信到账/触达/真机/体验版/公网部署未执行，详见[runbook](../../tasks/T012-release-readiness/runbook.md)。最终Git快照包在本功能提交后生成，包与备份/配置忽略，不进入Git。

## 2026-10-07 公开GitHub源码维护

- 用户明确授权公开仓库并允许Agent命名，禁止提交.env；目标hahah-bit/pindian-shopping-miniapp。账号通过GitHub CLI验证已登录。无领域/应用运行逻辑变更。
- GH01：`node .git/design-references/check-github-ignore.cjs`实际执行成功，18个敏感/本地路径被忽略，6个公开源码/示例路径保留。覆盖根/嵌套.env与变体、*.env、私钥与证书容器、凭据目录、开发者私有配置、媒体/数据库数据和实际验收截图。只保留.env.example与.env.production.example配置模板。
- GH02：`git ls-files`及`git log --all`证实.env、backend/.env及私有开发者配置从未进入Git；本机临时审计读取当前.env仅做凭据比对，扫描1452个历史blob/940个已跟踪文件，比对当前数据库密码/连接串、微信AppSecret与AI Key，并检查高置信度令牌/私钥格式，findings为空、exit0。审计输出只有种类/路径/计数，无密钥值，临时脚本/报告留在.git而非源码。此检查不声称能发现所有未知格式秘密。
- `git diff --check`通过；只精确暂存本次.gitignore与F048维护说明，协调/T005原未提交内容保留。没有改写历史，没有强推。
- 本次未运行应用专项/全量：只改Git忽略与源码传输维护，实际Git检查覆盖维护规范；应用最近实际验收为T015专项24/24后全量339/339。
- 忽略规则提交`402e90b chore(git): 完善公开仓库凭据与本地数据忽略规则`后再次执行历史审计：1458个blob，findings为空、exit0；所有检查只针对已跟踪Git内容，不导出本机.env。
- GH03通过：`gh repo create hahah-bit/pindian-shopping-miniapp --public --source . --remote origin`实际创建成功；随后`git push -u origin main`（命令级GitHub CLI凭据助手，不把令牌写入remote URL）exit0，main已跟踪origin/main。仓库[https://github.com/hahah-bit/pindian-shopping-miniapp](https://github.com/hahah-bit/pindian-shopping-miniapp)。
- `gh repo view ... --json url,visibility,defaultBranchRef`核验PUBLIC、默认分支main；首轮本地HEAD与`git ls-remote origin refs/heads/main`均为`402e90bb119ed90f5ac4dad0f73e812a8120c5da`。GitHub远端树查询仅见`.env.example`、`.env.production.example`，无.env或变体秘密文件。
- 本次公开源码维护已完成；后续仅同步本段真实发布记录，仍精确暂存。工作区原协调文件与T005目录保持未提交；不宣称小程序正式上线或安卓真机已验。
