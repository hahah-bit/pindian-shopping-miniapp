# T006 实施计划

依据：[spec](spec.md)、[DDD](ddd.md)、[决策 D006–D010](decisions/)。每完成一个子功能（测试通过）即本地 Git 提交。

## 测试策略（按 AGENTS 2.2 判断）

| 子功能 | 策略 | 范围 |
| --- | --- | --- |
| F020 支付单与渠道端口 | TDD | 支付单生命周期、资格核验、幂等、金额同源 |
| F021 支付确认 | TDD + PG 集成 | 回调解密入账、生效应用（预占转换/组满/消耗）、迟到退款、金额篡改、重复通知 |
| F022 退款 | TDD + PG 集成 | 五态迁移、取消已支付扣容量、组失败批量退款、Σ上限、人工重试 |
| F023 Worker | TDD | 查询补偿、退款驱动、重启恢复语义 |
| F024/F025 页面 | 非 TDD + 联调冒烟 | 状态覆盖、以后端为准 |

TDD 先行：`tests/task-suites/t006/`，确认失败后实现转绿。

- 专项 `npm run test:task:t006`：T006 单测 + 集成（真实 PG + 真实 HTTP + 假渠道端点装置：本地假微信支付服务模拟下单/查单/回调/退款）。**验证测试运行器按任务筛选**（run-all-tests.mjs t006 → tests/task-suites/t006）。
- 全量 `npm test`；Docker 重建迁移自动应用 + smoke + T002–T004 回归。

## 步骤

- [x] S1 契约与迁移：contracts（支付/退款 DTO）+ OpenAPI；迁移 0011–0014（0014 为集成测试发现的台账 delta 语义修正）；权限沿用 order:manage。→ 随 F020 提交
- [x] S2 F020 支付单与渠道端口（TDD）→ 提交
- [x] S3 F021 支付确认（TDD + 集成）→ 提交
- [x] S4 F022 退款流程（TDD + 集成）→ 提交
- [x] S5 F023 Worker 补偿（TDD）→ 提交
- [x] S6 F024 小程序页 → 提交
- [x] S7 F025 后台页 → 提交
- [x] S8 联调：Docker 重建 + 两端实测 + T002–T004 回归（2026-10-01 Docker 恢复后完成：4 容器 healthy、主库迁移至 0014、Worker 五任务运行、后台页可达；见 verification.md）→ 提交
- [x] S9 专项 → 全量 → 冒烟；失败修复后按专项→全量重验 → 提交（2026-10-01：专项 35/35，全量 154/154 含 0 跳过 DB 集成，Docker 冒烟通过）
- [x] S10 verification 回写 + 交付总结（提交哈希）→ 提交

## 完成标准

spec AC01–AC11 满足（AC11 中真实商户渠道验证如实记录为待用户环境）；无伪造支付路径；每子功能有提交哈希。

## 2026-10-01 独立验收回写

- 用户本轮要求验收，成功后提交 Git；本轮没有扩大为功能修复授权。
- 专项 35/35、全量 154/154（0 跳过）、Docker 冒烟通过；现有测试全绿不等于全部 AC 已满足。
- [独立验收记录](independent-acceptance.md)列出的阻塞未解决，S9/S10 的历史勾选仅表示原开发自测动作已执行，不表示本次独立验收完成。
- [ ] 修复回调验签生产装配、组失败退款、迟到退款建单失败恢复、退款页面状态与 D006 台账，并补回归测试。
- [ ] 覆盖退款事务回滚、退款回调及支付查单接入的缺口，重新专项 → 全量 → Docker/两端冒烟。
- [ ] 独立验收通过后，按用户要求提交本任务相关文件；不混入 T005 或协调目录的既有改动。

## 复验修复步骤（2026-10-01 独立验收 A01–A05 + 补充验证）

基线 `958ff9c` 验收未通过；以下按 TDD 先红后绿，全部完成后专项→全量→Docker→两端复验。

- [x] R1 A01 生产回调强制平台 RSA 验签：verifier 需平台公钥（未配置即拒绝）+ 四头齐全 + 原始报文体验签；入口保留 rawBody（Nest rawBody）；HTTP 回归覆盖带空白报文/缺签名/错签名（AC01/AC09）。
- [x] R2 A02 组截止失败退款：FailDeadlineGroupsTask 失效后扫描 paid 无退款订单 → 独立事务逐单 group_failed 全额退款；重复执行/部分失败/重启恢复（重扫 failed 组）（AC03/AC05）。
- [x] R3 A03 迟到退款事务化：payment 事实（succeeded+refunded_not_applied）与退款建单同事务；失败回滚可重放；succeeded-but-无退款 的历史态由重放兜底（AC04/AC05）。
- [x] R4 事务边界：PostgresRefundRepository.insert/save 贯穿 sessionTx；CreateFullRefundUseCase/CancelPaidOrderWorkflow 传递 sessionTx；真实 PG 故障注入回归（取消流程后续步骤失败→无孤立退款单）。
- [x] R5 A05 D006 让利台账：迁移 0015 group_settlements；组 success 同事务落账（幂等）；验收含不可整除/整除混合/取消重组/乱序（AC02）。
- [x] R6 退款回调：notify 按 event_type 分发（TRANSACTION.* → 支付确认；REFUND.* → RefundResultConfirmer）；解密资源含 out_refund_no/refund_status；幂等（AC07/AC03）。
- [x] R7 刷新语义：POST :id/payment-result 在 processing/unknown 时触发渠道查单并走确认流程（AC06）。
- [x] R8 A04 小程序退款进度：cancelled/expired 同样查询展示；区分"查询失败"与"无退款记录"（AC06）。
- [x] R9 文档回写（ddd/spec/plan/verification + 微信官方文档核验记录）→ 提交。
