# T008 实施计划

依据：[spec](spec.md)、[ddd.md](ddd.md)、D016–D018。

## 迁移

- **0018-customer-service.sql**：`cs_conversations`（user_id、status CHECK、assigned_agent_id→admins、last_seq、部分唯一索引：user_id WHERE status IN ('queued','active')）、`cs_messages`（conversation_id、seq、sender、kind、content jsonb、client_message_id；UNIQUE(conversation_id, seq)、UNIQUE(conversation_id, client_message_id)）、`cs_agent_presence`（agent_id 主键、heartbeat_at）、`after_sales_tickets`（user_id、type CHECK 七类、status CHECK、related、title/description）、`after_sales_ticket_actions`（只追加）。
- 兼容：全新表，无历史数据迁移。

## 测试策略（AGENTS 2.2）

| 子功能 | 策略 |
| --- | --- |
| F031 消息与会话 | TDD：seq 单调/幂等/ended 拒发/分页补取 + 真实 PG 并发 |
| F032 分配接入 | TDD：并发接入恰一人/转接审计/在线过期不入池 + 集成 |
| F033 卡片投影 | TDD：可见性（他人 404/未上架拒绝）+ 集成 |
| F034 工单与协调 | TDD：状态机/actions 只追加/退款资格失败回滚/补发协调 + 真实 PG 集成 |
| F035 两端页面 | 非 TDD + 构建/浏览器（小程序端点集成断言） |

## 步骤

- [x] S1 任务目录 + DDD/spec + D016–D018 → 提交
- [ ] S2 迁移 0018 + F031 聚合/仓储/用例（TDD）→ 提交
- [ ] S3 F032 分配接入转接备注心跳（TDD）→ 提交
- [ ] S4 F033 卡片投影端点（TDD）→ 提交
- [ ] S5 F034 工单聚合/公开用例协调（TDD）→ 提交
- [ ] S6 控制器（mini/admin）+ contracts/OpenAPI → 提交
- [ ] S7 F035 两端页面（客服工作台/小程序会话页）→ 提交
- [ ] S8 集成测试（真实 PG+HTTP：并发接入/幂等/补取/转工单/退款失败回滚/越权）→ 提交
- [ ] S9 T008 专项 → 全量 → Docker 冒烟 → 两端交互 → verification 回写 → 提交

## 验收命令

- 专项：`npm run test:task:t008`（run-all-tests 注册 t008）
- 全量：`npm test`；Docker：compose build + up + smoke（迁移 0018）

## 完成标准

spec AC01–AC10 满足；D017/D018 如实标注建议方案；语音/视频/文件/AI 不实现；未验项（真机等）如实记录。
