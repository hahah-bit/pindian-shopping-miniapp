# T008 整改接口契约（2026-10-02）

使用 `Authorization: Bearer <token>`，小程序为用户登录域，后台为管理员域。JSON 成功结构 `{data,requestId}`，错误结构 `{code,message,requestId}`；UUID 引用，时间 ISO-8601，金额整数分。分页 page≥1、pageSize=1–100，默认 1/10；消息 afterSeq≥0、limit=1–100，默认 0/50。

## 会话、消息与读确认

- 会话视图 `{id:UUID,status:queued|active|ended|converted,hasAgent:boolean}`，不返回作者、用户标识或客户端键。
- 消息 `{seq:integer,sender:user|agent|system,kind:text|image|card|note,content:object,createdAt:string}`；只有后台增加 `internal:boolean`，用户没有 note。文本/备注 content=`{text:string(1–2000)}`，图片=`{mediaAssetId:UUID}`，卡片=`{cardKind:product|order|group|refund,cardRefId:UUID}`。
- 增量返回 `{messages:Message[],nextSeq:integer,lastSeq:integer}`。nextSeq 为本页最后已返回消息，空页沿用 afterSeq；lastSeq 为会话水位，不能用作翻页游标。用户可见性在数据库分页之前筛选。后台历史仅原负责客服可读。
- 发送请求 `{clientMessageId:string(1–64),kind,content,internal?:boolean}`，新消息 HTTP 201，同身份同键同内容 HTTP 200，返回 `{message,duplicated:boolean}`。同键异内容 `MESSAGE_ID_CONFLICT`409；对象字段顺序不影响比较。用户发送内部备注400。会话关闭后不能新增，原有发送键恢复以授权复核为准。
- POST `/api/mini/v1/conversations` →201 `{conversation}`；同用户并发创建返回同一会话。GET 同路径 →200 `{items:Conversation[],total,page,pageSize}`，含结束历史。
- GET `/api/mini/v1/conversations/:id`、后台 `/api/admin/v1/cs/conversations/:id` →200 `{conversation}`；本人或原负责客服范围，否则404。
- POST `/api/mini/v1/conversations/:id/read`，`{seq:integer≥0}` →200 `{ok:true}`，只能确认已存在的可见消息，读位点只递增。
- POST `/api/admin/v1/cs/heartbeat` →200 `{ok:true,at:string}`，实际落库在线事实并分配排队会话，60秒未续期即离线；按最少 active 数分配，同量按心跳、ID排序。GET `/cs/agents` →200 `{items:[{id,displayName,activeCount}]}`，仅启用且在线的客服角色。
- GET 后台 `/cs/conversations?status=&page=&pageSize=` →200 `{items,total,page,pageSize}`，仅本人；队列最多50条，离线排队可留言。手动接入竞争一人200、另一人409；转接目标离线或无权限 `AGENT_NOT_ONLINE`409。

## 私有图片与卡片

POST 用户 `/api/mini/v1/conversations/:id/images`、后台 `/api/admin/v1/cs/conversations/:id/images`：multipart 字段 file，PNG/JPEG/WebP，魔数和头部宽高验证，沿用图片尺寸60–6000，最多5MiB；不依赖文件名/MIME声明，→201 `{id:UUID,width:integer,height:integer}`。生产库私有 bytea 存储，图片不经商品公开媒体路由。GET 用户 `/api/mini/v1/chat-images/:id`、后台 `/api/admin/v1/cs/images/:id`：本人或负责客服下载原字节，200真实类型、`private,no-store`和`nosniff`；未登录401、越权404、类型不支持415、大小超界413、尺寸非法400。发送时再次检查图片属于当前会话。

GET 用户 `/api/mini/v1/cards/options/:kind`、后台 `/api/admin/v1/cs/conversations/:id/card-options/:kind` →200 `{items:[{id:UUID,label:string}]}`，最近最多50条；商品为上架商品，其余为本人交易。GET 用户 `/api/mini/v1/cards/:kind/:id`、后台 `/api/admin/v1/cs/conversations/:id/cards/:kind/:ref` →200投影；商品 `{product:{id,name,unit,originalPriceFen,wholeQuantityText,mainImageId}}`；订单 `{order:{id,orderNo,status,units,totalAmountFen,createdAt}}`；组 `{group:{id,status,paidUnits,unit,wholeQuantityText}}`；退款卡引用订单，`{refund:{orderId,paidAmountFen,items:[{status,amountFen,createdAt}]}}`。卡片发送和读取复用同一授权端口，不能发送他人引用。

## 工单和后台角色

- 用户 POST `/api/mini/v1/tickets` 请求 `{type,title:string(1–60),description:string(1–2000),orderId?:UUID,clientTicketId?:string(1–64)}`。type为七种既有类型；→201 `{ticket:{id,status}}`。生产客户端均传 clientTicketId，同用户同键同内容恢复原单，异内容 `IDEMPOTENCY_CONFLICT`409；引用越权404。GET 列表返回 `{items:[{id,type,title,status,createdAt}],total,page,pageSize}`。
- 详情 `{ticket:{ticketId,conversationId,type,status,title,description,relatedOrderId,relatedGroupId,relatedRefundId,createdAt,updatedAt},actions:[{action,actorType,detail,createdAt}]}`。用户不返回内部记录或 actorId；后台授权范围内增加 assignedAgentId 和 actorId。普通客服仅可看未受理摘要和本人已受理工单详情；主管可看全部工单。
- 状态 open→processing→waiting_feedback→resolved→closed；不满意反馈将 waiting_feedback/resolved→processing。closed不可回退。
- 后台受理、回复、请求反馈、解决、关闭使用既有工单 POST 路由，增加 `/request-feedback`。请求分别为 `{clientActionId?}`、`{text,clientActionId?}`、`{text,clientActionId?}`、`{reply,clientActionId?}`、`{reason,clientActionId?}`；回复1–2000字。返回200 `{ticket:{id,status}}`。当前用户反馈 `{satisfied:boolean,text?:string≤2000,clientActionId?:string(1–64)}` →200同结构。
- clientActionId 按工单/身份类别/身份ID持久化唯一；同键同动作同内容只写一次 action/审计，异内容409。查重先于状态迁移、晚于身份授权，工单锁内处理；前端失败时保留原键与内容重试。无键受理由原受理身份恢复，其他人不能抢占；无键关闭已关闭单幂等。
- 新角色 cs_agent 只有agent:manage，cs_supervisor增加agent:supervise；退款/补发采用用户已确认 D020：客服申请，超级管理员审核后执行，详见下节。
- GET/POST `/api/admin/v1/cs/accounts` 仅super_admin，创建请求 `{username,displayName,password:string(10–128),role:cs_agent|cs_supervisor}` →201 `{id,username,displayName,role,status}`；GET→200 `{items:summary[]}`。POST `/:id/status` `{status:active|disabled}` →201summary，仅客服角色账号；停用撤销全部旧session。密码不进入响应/审计。未授权403。

## 履约异常

GET `/api/admin/v1/fulfillment/blocks`，order:manage，→200 `{items:[{groupId:UUID,reason:ZERO_ALLOCATION|INVALID_QUANTITY,createdAt:string,orderIds:UUID[]}]}`，最多100条最近异常。历史组暂停生成，不改交易快照；新上架和下单若任一合法有序组合产生零数量，则 `PRODUCT_NOT_PUBLISHABLE`409。零分配异常逐单申请审核退款，审批前不产生退款。

## 审核售后（D020）

完整契约见 [F036 spec](../docs/features/F036-reviewed-after-sales/spec.md) 与 OpenAPI：refund/reshipment 提交202待审核请求，requests列表200，review仅super_admin并发幂等，fulfillment摘要受工单归属保护；异常逐单 refund-request 返回202。退款按实际支付全额（含服务费）、reason=after_sales，生成停止履约记录；executed仅代表创建指令/包裹，实际到账由渠道状态证明。原直接履约接口 isReissue:true 返回409 REVIEW_REQUIRED。用户详情 requests 排除申请人/审核人ID。
