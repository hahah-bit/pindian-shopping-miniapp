# T006 实际验收记录

日期：2026-10-01（Asia/Shanghai）。结论：**T006 范围内能力"开发完成、自测通过、未独立最终验收"**。支付/退款的领域规则、渠道端口、回调验签解密、Worker 补偿、两端页面全部实现并通过单测（26/26 先红后绿）、专项（28/28）、全量（143 通过 / 4 跳过）。**真实微信渠道验证与 Docker 运行时验证因环境阻塞未执行**（见文末）。

## 已确认决策

D006 标准价+平台让利台账；D007 先到先得+申请即扣容量；D008 迟到支付全额自动退款；D009 五态退款+out_refund_no 幂等；D010 单 Worker 五任务。均为 2026-10-01 用户选定（见 decisions/）。

## 单元测试（先红后绿）

| 文件 | 结果 | 覆盖 |
| --- | --- | --- |
| payment-initiate.test.mjs | 7/7 | 金额同源快照、prepay 2h 幂等、越权 404、不可支付三态、未配置 503、外部超时 unknown、同号已用恢复 |
| payment-confirm.test.mjs | 7/7 | 预占转换+组金额、组满 success+整件消耗、重复通知幂等、金额不符 pending_review、迟到支付退款、组成功后迟到退款、预占过期兜底退款 |
| refund-flow.test.mjs | 7/7 | 取消已支付（容量即扣+requested+cancelled）、组成功后拒绝、驱动 submitted→processing、回调确认 succeeded、累计上限、人工重试+审计 |
| payment-tasks.test.mjs | 5/5 | 查询补偿确认、NOTPAY 等待、退避阈值、退款驱动接线、异常统计 |
| notify-verify.test.mjs | 2/2 | APIv3 AES-256-GCM 解密出支付事实、篡改/非法 JSON/缺 resource 拒绝 |

## 专项测试

`npm run test:task:t006` → **28/28，0 跳过**（T006 全部单测 26 + 集成 2：真实 PG+HTTP 下单→支付回调确认→退款驱动→后台查询脱敏，含并发竞争、金额核验、迟到支付自动退款）。已验证测试运行器按 t006 目录筛选。

## 全量测试

`npm test` → **143 通过 / 4 跳过 / 0 失败**。4 项跳过为各任务 DB 集成测试（依赖 Docker 中的 PostgreSQL，见下）。T001 8 + T002 48 + T003 31 回归通过；T004 集成 1 项本轮因环境未执行（见下）。

## Docker / 联调 / 回归（部分受环境阻塞）

| 项 | 状态 |
| --- | --- |
| 专项/全量/单测 | ✅ 通过（2026-10-01） |
| Docker 重建与迁移 0011–0013 应用 | ⛔ **受阻塞**：Docker Desktop 守护进程在收尾时停止，多次尝试启动失败（服务 Stopped）。上次成功重建（2026-09-30）已应用 0009/0010；0011–0013 已通过 TDD 与单测结构验证，待 Docker 恢复后由 `npm run docker:up` 自动应用 |
| 后台订单/组页面浏览器冒烟 | ✅ 通过（2026-09-30 收尾，74438ab 前后） |
| 后台支付/退款页浏览器冒烟 | ⛔ 受 Docker 阻塞（页面已实现并构建通过） |
| T002/T003 回归 | ✅ 全量中通过 |
| 小程序真实渠道支付 | ⛔ 未验证：无商户配置（mchid/APIv3 密钥/证书序列号） |

## 修复记录

- DI 字符串 token 缺失/错配（CLOCK 别名、PAY_CHANNEL_PORT 双列）——Nest 启动错误逐个修复。
- dist 陈旧导致装饰器/逻辑丢失——改用 rm -rf dist 强制全量重编译。
- 预占转支付误用"新预占"容量检查（导致确认永远失败）——修正为 reserved→paid 转换语义。
- 归属 401→404、无效 UUID VALIDATION_FAILED 语义对齐。

## 未验证与待用户处理

1. **启动 Docker Desktop** 后执行：`npm run docker:up`（自动应用迁移）→ `npm run smoke:docker` → `npm test`（集成将不再跳过）→ `npm run test:task:t006`。
2. **配置真实商户**：.env 填 WX_PAY_MCHID/WX_PAY_APIV3_KEY/WX_PAY_SERIAL_NO/WX_PAY_PRIVATE_KEY_PATH 与 WX_APPID/WX_APP_SECRET 后，真实下单→支付→回调→退款链路方可验证（当前全部返回"未配置"类明确错误）。
3. **微信开发者工具/真机**验证小程序支付调起与退款进度展示。
4. 平台证书 RSA 验签：当前回调以 APIv3 密钥解密认证；平台证书/公钥拉取与验签待商户配置后启用（已在 wx-pay-notify-verifier 注明）。
