# T008 规格说明（spec）

依据：[需求 §7](../../requirements/pindian-shopping-mini-program-requirements.md)、[ddd.md](ddd.md)、D016–D018。第一版不含语音/视频/文件/AI。

## 1. 接口契约

通用：用户端 bearer（AuthRealm user）+ 本人校验；客服端 bearer（admin，`agent:manage` 权限——仅会话/工单操作）；错误 `{code,message,requestId}`；时间 ISO-8601；分页 `page/pageSize≤100` 或 `afterSeq` 增量。

### 1.1 小程序（用户）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/mini/v1/conversations | 发起/恢复会话：已有未结束会话返回原会话；否则 queued 入队（无人在线=留言语义）。201 `{conversation:{id,status,assignedAgentName?}}` |
| GET | /api/mini/v1/conversations/current | 本人未结束会话（无则 `{conversation:null}` 空态） |
| GET | /api/mini/v1/conversations/:id/messages?afterSeq=&limit≤100 | 增量拉取（断线补取）：`{messages:[{seq,sender,kind,content,createdAt}],lastSeq,agentTyping?}`；非本人 404 |
| POST | /api/mini/v1/conversations/:id/messages | 发送：`{clientMessageId, kind:text|image|card, content:{text?/mediaAssetId?/cardKind?/cardRefId?}}`；201 `{message:{seq,...}}`；重复 clientMessageId 200 原消息 |
| POST | /api/mini/v1/conversations/:id/end | 用户结束会话 |
| GET | /api/mini/v1/cards/product/:id | 卡片只读投影（上架商品摘要：名称/图/价格） |
| GET | /api/mini/v1/cards/order/:id | 本人订单摘要卡片 |
| GET | /api/mini/v1/cards/group/:id | 本人所在拼单组摘要卡片 |
| GET | /api/mini/v1/cards/refund/:orderId | 本单退款记录摘要卡片 |

### 1.2 客服后台（agent:manage；分配策略仅在线客服）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/admin/v1/cs/queue | 排队中会话列表（等待时长排序） |
| POST | /api/admin/v1/cs/conversations/:id/accept | 接入：queued→active；并发接入恰一人成功（409）。自动分配亦可由服务端在 accept 时按"在线且接待量最少"指派建议 |
| GET | /api/admin/v1/cs/conversations?status=&page= | 我的/全部会话分页 |
| GET | /api/admin/v1/cs/conversations/:id/messages?afterSeq= | 同用户端（客服仅限分配给自己的会话） |
| POST | /api/admin/v1/cs/conversations/:id/messages | 客服回复（同消息协议，sender=agent） |
| POST | /api/admin/v1/cs/conversations/:id/transfer | 转接：`{targetAgentId}`（须在线）；写审计 |
| POST | /api/admin/v1/cs/conversations/:id/notes | 内部备注：`{text≤1000}`（用户不可见；存 messages.sender=agent, internal=true） |
| POST | /api/admin/v1/cs/conversations/:id/end | 结束 |
| POST | /api/admin/v1/cs/conversations/:id/convert-ticket | 转工单：`{type, title, description}` → 创建工单（open），会话 converted |
| GET | /api/admin/v1/cs/heartbeat | 客服在线心跳（写在线表，60s 过期） |

### 1.3 售后工单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/admin/v1/after-sales/tickets?status=&type=&page= | 工单分页（脱敏：电话不展示） |
| GET | /api/admin/v1/after-sales/tickets/:id | 工单详情 + actions（含退款/补发结果引用） |
| POST | /api/admin/v1/after-sales/tickets/:id/accept | open→processing（审计） |
| POST | /api/admin/v1/after-sales/tickets/:id/reply | 处理回复（记录 action） |
| POST | /api/admin/v1/after-sales/tickets/:id/refund | D020：`{orderId,reason,clientRequestId}`→202待审核申请，按成功/失败组本人有效支付事实核定全额；批准后创建after_sales退款，到账另看渠道状态 |
| POST | /api/admin/v1/after-sales/tickets/:id/reshipment | D020：`{orderId,fulfillmentId,quantityGrams,company,trackingNo,reason,clientRequestId}`→202待审核，批准后创建补发包裹并审计；最小单位见F036 |
| POST | /api/admin/v1/after-sales/tickets/:id/resolve | 管理员标记解决（附答复） |
| POST | /api/admin/v1/after-sales/tickets/:id/close | 关闭（附原因；审计） |
| GET | /api/mini/v1/tickets?&page= | 本人工单列表 |
| GET | /api/mini/v1/tickets/:id | 本人工单详情（含管理员答复 actions，不含内部备注） |
| POST | /api/mini/v1/tickets/:id/feedback | 用户反馈：`{satisfied:bool, text?}`（resolved 前提下确认解决→resolved confirmed；或继续追问→状态回 processing） |
| POST | /api/mini/v1/tickets | 用户提交工单：`{type, title, description, orderId?}` |

### 1.4 错误码

`CONVERSATION_NOT_QUEUED`(409 并发接入/已结束)、`CONVERSATION_ENDED`(409)、`MESSAGE_INVALID`(400)、`DUPLICATE_CLIENT_MESSAGE`(200 幂等返回)、`TICKET_NOT_FOUND`(404)、`TICKET_STATE_CONFLICT`(409)、`REFUND_NOT_ALLOWED`(409)、`FORBIDDEN`(403)、`NOT_FOUND`(404)。

## 2. 权限与脱敏

- 客服操作需 `agent:manage` + 会话分配校验（assignedAgent=self；未分配会话仅可见队列摘要）；super_admin 全部权限。
- 用户仅本人会话/工单（他人一律 404）。
- 工单列表/详情不展示用户电话明文；客服查看用户信息经既有 user:manage reveal 路径（审计）。
- 审计动作：`cs.transfer`、`cs.convert_ticket`、`ticket.accept/reply/refund/reship/resolve/close`。

## 3. 验收条件

- AC01 会话生命周期：发起/排队/留言语义/接入/结束/转工单状态机正确；并发接入恰一人。
- AC02 消息：seq 单调、clientMessageId 幂等、断线 afterSeq 补取、分页 ≤100、ended 会话拒发。
- AC03 卡片：四类卡片投影与可见性（用户仅本人订单/组/退款；商品需上架）。
- AC04 分配：accept 时"在线且接待量最少"建议；客服离线（心跳过期）不入分配池。
- AC05 工单：状态机（open→processing→resolved/closed）、七类型、actions 只追加、用户反馈回环。
- AC06 售后协调：退款经支付公开用例（资格/额度校验失败 409 且工单无半条 action）；补发经履约公开用例（D013）；全部审计。
- AC07 权限：agent:manage 403 边界（其他管理员角色）；用户/客服越权 404/403。
- AC08 集成（真实 PG+HTTP+生产装配）：并发接入、消息幂等/补取、转工单、退款协调失败回滚、补发协调、越权。
- AC09 专项→全量→Docker→两端交互；小程序真机/开发者工具如实记录。
- AC10 第一版不含语音/视频/文件/AI；超时提醒不做（D018）。

## 4. Given/When/Then

- **Given** 无客服在线，**When** 用户发起会话并发消息，**Then** 会话 queued + 消息入库（留言），客户端提示留言。
- **Given** 排队会话 1 条，**When** 两客服并发 accept，**Then** 恰一人 active、另一人 409。
- **Given** 用户发送 clientMessageId=x 两次，**When** 服务端处理，**Then** 仅一条消息、两响应同 seq。
- **Given** 会话 30 条消息，**When** 客户端 afterSeq=20 拉取，**Then** 返回 21-30 升序。
- **Given** 工单关联已全额退款订单，**When** 管理员再发起退款，**Then** 409 且工单无新 action。
- **Given** 转工单成功，**When** 用户再发消息，**Then** 409 CONVERSATION_ENDED（converted 只读）。

## 2026-10-02 已批准修订

原D017直接执行建议被用户D020取代，退款和补发先202申请再超级管理员审核执行；详细输入输出、状态、权限、幂等、单位、异常及AP01–08见 [F036 spec](../../features/F036-reviewed-after-sales/spec.md)。会话消息/私有图片/卡片/工单/账号新契约见 [整改契约](../../../contracts/cs-remediation.md)。AC04采用真实在线持久心跳和最少接待量分配；AC05支持waiting_feedback、反复回复和未解决回processing。AC06/08必须验证成功组实付退款、审核并发及跨域事务回滚；最终验证覆盖这些修订。
