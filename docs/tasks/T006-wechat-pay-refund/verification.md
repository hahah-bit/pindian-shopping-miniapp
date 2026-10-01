# T006 实际验收记录

日期：2026-10-01（Asia/Shanghai）。结论：**T006 范围内能力"开发完成、自测通过、未独立最终验收"**。支付/退款的领域规则、渠道端口、回调验签解密、Worker 五任务、两端页面全部实现；专项 35/35、全量 154/154（0 跳过，DB 集成含在内）、Docker 冒烟通过。**真实微信商户渠道验证因无商户配置未执行**（见文末），不将支付闭环标记为"渠道已验证"。

## 已确认决策

D006 标准价+平台让利台账；D007 先到先得+申请即扣容量；D008 迟到支付全额自动退款；D009 五态退款+out_refund_no 幂等；D010 单 Worker 五任务。均为 2026-10-01 用户选定（见 decisions/）。

## 单元测试（先红后绿）

`npm run test:task:t006` → **35/35，0 跳过**（单元 34 + 集成 1）。

| 文件 | 结果 | 覆盖 |
| --- | --- | --- |
| payment-initiate.test.mjs | 7/7 | 金额同源快照、prepay 2h 幂等、越权 404、不可支付三态、未配置 503、外部超时 unknown、同号已用恢复 |
| payment-confirm.test.mjs | 7/7 | 预占转换+组金额、组满 success+整件消耗、重复通知幂等、金额不符 pending_review、迟到支付退款、组成功后迟到退款、预占过期兜底退款 |
| refund-flow.test.mjs | 8/8 | 取消已支付（容量即扣+requested+cancelled）、组成功后拒绝、驱动 submitted→processing、**提交异常落 failed（不无限静默重试）**、**人工重试重置 requested 且 retryCount+1**、回调确认 succeeded、累计上限、人工重试+审计 |
| payment-tasks.test.mjs | 5/5 | 查询补偿确认、NOTPAY 等待、退避阈值、退款驱动接线、异常统计 |
| notify-verify.test.mjs | 2/2 | APIv3 AES-256-GCM 解密出支付事实、篡改/非法 JSON/缺 resource 拒绝 |
| wx-pay-adapter.test.mjs | 5/5 | WECHATPAY2-SHA256-RSA2048 Authorization 官方格式+RSA 验签、paySign 可验签、未配置全方法显式报错、回调平台私钥验签、AES-256-GCM 解密 |

修复记录（TDD 先红后绿）：退款驱动提交异常原实现仅记日志（单据滞留 requested、永不进入异常队列）→ 先写失败测试再修复为落 failed；人工重试原实现置 submitted 但驱动只提交 requested（死胡同）→ 领域新增 `markRetryRequested`（failed→requested，retryCount+1），由驱动按幂等键 out_refund_no 重提。

## 集成测试（真实 PostgreSQL + 真实 HTTP API + 本地假微信渠道服务）

`tests/task-suites/t006/integration-db-http.test.mjs` → **1/1 通过**。生产装配（FoundationModule 全量 DI + HttpWxPayAdapter 经 `WX_PAY_ENDPOINT_BASE` 指向本地假渠道）+ 独立测试库 `pindian_t006_test`（不触碰主库）。覆盖：

1. 三笔 1/3 支付生效：真实适配器下单 → 回调（真实 AES-256-GCM 报文）→ 预占转换 → 组满 60 → 组 success + 整件消耗；Σ已支付订单金额 = 组金额累计（50499 ≤ 50500，让利 1 分走 D006 台账）。
2. 重复通知幂等：同事实重投 → 200，容量/金额不重复计。
3. 金额不符 → `pending_review` 异常队列；后台 `payment-anomalies` 计数可见。
4. 迟到支付（预占过期任务后回调）→ `refunded_not_applied` + D008 全额自动退款（late_payment）→ 退款驱动 processing → 渠道查询 SUCCESS → succeeded；小程序退款进度端点本人可见、他人 404。
5. 已支付取消（D007 容量即扣）→ 渠道提交失败 → failed（fail_reason=SYSTEM_ERROR）→ 管理员重试（401 未登录/401 用户 token 鉴权独立成立）→ 重置 requested + retryCount+1 → 驱动重提 → 到账；操作审计落库。
6. 金额与库存一致性断言贯穿全程（stocks available/reserved 逐步校验）。

集成测试发现并修复的生产缺陷（修复后专项→全量重验）：

| 缺陷 | 修复 |
| --- | --- |
| payments INSERT 15 占位符/15 参数对 14 列（支付单创建必 500） | 列数对齐 14 |
| InitiatePayment 被注入订单聚合而非扁平投影，归属判断恒 NOT_FOUND | 装配层聚合→端口投影 |
| NOTIFY_APPLIER 包装调用不存在的方法名（迟到退款链路断裂） | `refunds.execute(i)` |
| consumeOne 台账 delta=0 违反迁移 0005 CHECK（组满消耗必 500） | 迁移 0014：CHECK 放宽为有界区间（-100000..100000），保留初始调整 ±N |
| `deductPaidForCancel` 端口声明但 Postgres 适配器未实现 | PostgresGroupRepository 实现行锁+条件更新 |
| 取消端点未分发已支付取消（409） | 控制器按订单状态分发未支付/已支付工作流 |
| 500 无服务端日志 | 过滤器对 ≥500 打印异常（不泄露客户端） |

## 全量测试（含 T002–T004 回归）

`npm test`（typecheck + build + 架构检查 + 全部测试）→ **154/154 通过，0 失败，0 跳过**。此前 4 项跳过的 DB 集成测试（T002/T003/T004/T006）在 Docker 恢复后全部实跑通过。

## Docker 冒烟（2026-10-01）

| 项 | 结果 |
| --- | --- |
| `docker compose build` + `up -d --force-recreate` | ✅ 4 容器（postgres/api/worker/admin）全部 healthy |
| 主库迁移 | ✅ schema_migrations 0001–0014 全应用；`stock_movements_delta_check` 为修正后约束 |
| Worker 五任务 | ✅ 日志"业务任务循环启动：预占过期 / 组截止 / 支付查询补偿 / 退款驱动 / 异常统计"；health.json `businessTasksEnabled: true` |
| API | ✅ `/api/health/ready` 200；新路由 `POST /api/admin/v1/refunds/:id/retry` 未认证返回 401（路由与鉴权在部署镜像中生效） |
| 后台前端 | ✅ `http://127.0.0.1:8080` 200（含支付与退款页 F025，构建通过） |
| 后台支付/退款页浏览器交互冒烟 | ✅ 页面构建与路由可达（真实商户数据为空属预期） |

## 未验证与待用户处理

1. **真实微信渠道**：无商户配置（mchid/APIv3 密钥/商户证书与序列号/平台证书），真实下单→支付→回调→退款无法验证。当前未配置时全部方法显式报 `WECHAT_PAY_NOT_CONFIGURED`，无任何"模拟成功"路径。配置后：.env 填 WX_PAY_MCHID / WX_PAY_APIV3_KEY / WX_PAY_SERIAL_NO / WX_PAY_PRIVATE_KEY_PATH（可选 WX_PAY_ENDPOINT_BASE 仅限联调指向本地假渠道，生产勿设）。
2. **平台证书/公钥验签**：回调当前以 APIv3 密钥解密 + mchid 核验认证；平台证书 RSA 验签待商户配置后启用（wx-pay-notify-verifier 已注明）。
3. **微信开发者工具/真机**：小程序支付调起（wx.requestPayment）与退款进度展示需真机环境。
4. 独立最终验收由另一位 Agent 负责；本记录仅为开发自测。
