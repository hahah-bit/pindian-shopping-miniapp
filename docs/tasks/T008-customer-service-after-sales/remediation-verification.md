# T007/T008 整改最终验证

结论：本轮授权整改及本地开发验收通过。D015、D019、D020均由用户明确确认；真实渠道和真机验收保留为发布环境待办。

日期：2026-10-02（Asia/Shanghai），审查基线 fba6d39，本次由 Codex 按整改设计和已确认决策实施。

| 验证 | 实际结果 |
| --- | --- |
| npm run test:task:t007 | 41/41，0失败、0跳过；构建、架构扫描通过 |
| npm run test:task:t008 | 36/36，0失败、0跳过；构建、架构扫描通过 |
| npm test（两项专项通过后） | 249/249，0失败、0跳过；全工作区类型检查、构建、架构扫描通过 |
| 最新隔离 Docker 构建与 smoke-docker.mjs | 通过；迁移0019–0026；PG/API/Admin/Worker健康。项目 pindian-remediation-review 及其临时卷已清理，原项目不受影响 |
| 真实PG+HTTP生产装配 | 会话并发创建、自动分配、可见性前置分页、私有图片授权、工单归属/动作重试/反馈；两个真实普通客服竞争；两个不同超级管理员并发审核成功组退款只创建一笔；实际支付全额含服务费；退款 action 失败及补发审计失败同事务回滚；completed补发不改正常进度；历史3件30/15/15暂停及逐单审核；退款先于首次生成时停止该订单、其他订单原分配不变 |
| 有数据后台浏览器 | 实际操作会话回复/备注、工单受理/回复/请求反馈（前段整改）；最终实际提交补发申请进入pending、填写审核意见后审核控件可用；异常列表逐单申请并链接到具体工单，展示含服务费实付金额和待审核状态。审批执行由真实PG/HTTP测试验证，浏览器没有点击批准资金交易 |
| 小程序页面 | TypeScript检查；隔离Page生命周期及响应丢失重试模拟2例；真实API本人权限/反馈/图片/卡片联调。没有运行微信开发者工具或真机，不将模拟算作真机验证 |

日志在本机 .git/t007-final-suite.log、t008-final-suite.log、remediation-final-full.log、remediation-final-docker.log、t008-reviewed-real.log、t008-browser-fixture.log。截图：.git/t008-approved-ui.jpg、.git/t008-anomaly-approval-ui.jpg（均隔离测试数据）。这些日志/截图属于本机证据，不进入版本库。

测试红灯证据：t008-reason-boundary-red.log（新增第6例补发原因存储边界），t008-approval-red.log、t007-approval-bypass-red.log、t008-action-idempotency-red.log、t008-jsonb-idempotency-red.log、t008-action-http-red.log、t008-mini-workflows-red.log；红灯因目标业务行为未满足，随后相关测试通过。历史探测只用来复现问题，不作为修复通过证据。

限制：未连接真实微信支付/退款环境，未验证渠道真实受理/到账及真机交互；退款executed仅表示创建退款请求。发布前需使用用户环境另做真实渠道与真机验收。D018超时提醒/升级仍为未确认建议，列入通知阶段决策，不能宣称整个MVP已经完成。
