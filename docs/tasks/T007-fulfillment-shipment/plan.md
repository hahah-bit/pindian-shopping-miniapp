# T007 实施计划

依据：[spec](spec.md)、[ddd.md](ddd.md)、决策 [D011–D015](decisions/)。每子功能测试通过即本地提交。

## 迁移与兼容

- **0016-fulfillment.sql**：`fulfillment_orders`（order_id 唯一；状态 CHECK；收货快照扁平列 + receiver_version）、`shipments`（(company, tracking_no) 唯一；is_reissue；quantity_grams ≥ 0…实际 >0 CHECK）。无破坏性变更；旧数据无涉（全新表）。
- 兼容：组/订单/支付零改动；组履约进度为读投影；Worker 任务 5→6（D010 循环模式扩展，记录于 decisions）。

## 测试策略（AGENTS 2.2）

| 子功能 | 策略 | 范围 |
| --- | --- | --- |
| F026 分配 | TDD（纯函数，穷举守恒/边界） | 整除/混合/单订单/1/3 不可整除/0 与非法输入/守恒证明 |
| F027 生成 | TDD + 真实 PG | 幂等（重复扫描）、组级原子（部分失败回滚）、重启恢复 |
| F028 管理履约 | TDD + 真实 PG | 守恒、超发/重复运单 409、并发发货锁内串行、改址锁定、完成幂等、权限、审计 |
| F029 导出 | 非 TDD + 冒烟 | CSV 列/编码/审计 |
| F030 小程序 | TDD（用例层）+ 集成 | 本人 404 语义、确认收货幂等、空态 |

集成（真实 PG + HTTP + 生产装配，tests/task-suites/t007/integration-db-http.test.mjs）：覆盖 AC10 全部路径。**跳过不计通过。**

## 实施步骤

- [x] S1 任务目录 + DDD/spec + 决策 D011–D015 → 提交
- [x] S2 F026 数量分配领域服务（TDD）→ 提交
- [x] S3 F027 迁移 0016 + 履约聚合 + 生成任务 + Worker 接线（TDD + 真实 PG）→ 提交
- [x] S4 F028 管理端点（列表/明细/发货/补发/改址/完成）+ 审计（TDD）→ 提交
- [x] S5 F029 CSV 导出 → 提交
- [x] S6 F030 小程序端点 + 页面（detail 页履约卡片 + 确认收货）→ 提交
- [x] S7 contracts DTO + OpenAPI 路径 → 提交
- [x] S8 集成测试（AC10 全路径）→ 提交
- [ ] S9 T007 专项（run-all-tests t007）→ 全量 → Docker 冒烟 → 两端交互验收 → 提交
- [ ] S10 verification 回写 + 交付报告 → 提交

## 验收命令

- 专项：`npm run test:task:t007`（run-all-tests.mjs 增补 t007 目录映射）
- 全量：`npm test`
- Docker：`docker compose build && docker compose up -d --force-recreate` + smoke（迁移 0016、healthy、两端可达）


## 独立审查修复（2026-10-01，基线 f087b35 审查未通过；D011–D014 同日经用户确认，D015 未确认）

- [x] R01 单位注册表：toMinimalUnits/formatQuantity（重量克化+计数整件+未知单位拒绝留痕）；生成任务与两端展示改按原快照单位（先红后绿；10 克组回归 [5,5]）
- [x] R03 普通详情去除明文电话（集成断言：响应全文不含完整号码）
- [x] R04 审计事务化：发货/改址/完成审计与业务同事务（真实 PG 故障回归：审计失败→整单回滚、不漏审计、恢复后同运单号重试成功且审计恰一条）
- [x] R06 补发边界（D013 已确认）：补发不改状态（pending/completed 均保持）、completed 可补发、任何包裹（含补发）锁地址（单测先红后绿 + 集成）
- [x] R05 后台改址表单/标记完成入口（版本反馈/确认/失败提示）+ 有数据隔离环境浏览器验收
- [x] R07 回归：真争抢屏障（双任务同时候选同组）、首单成次单败真实回滚、catalog_admin 403（迁移 0017 + 需求 §6.1 商品管理员）、单位/脱敏断言
- [ ] R08 子功能文档补齐（如实标注补充时间）→ 专项 → 全量 → Docker → 有数据后台交互 → verification 回写 → 提交（提交后待独立复验）

## 完成标准

spec AC01–AC11 满足（物流渠道/真机无对接属范围外，如实记录）；数量守恒有测试证明；不混入 T005/F019 与协调目录修改。
