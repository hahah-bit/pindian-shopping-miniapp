# 审批功能 spec

依据 D020、D019、D013。范围：普通售后申请、超级管理员审核、历史异常组申请入口、工单两端结果展示；真实微信退款走已有渠道驱动，本轮仍需真实环境单独验证。

POST `/api/admin/v1/after-sales/tickets/:id/refund` 或 `/reshipment` 需 agent:manage，工单归本人（主管/超级管理员可协作），processing/waiting_feedback。退款 `{orderId:UUID,reason:string(1–1000),clientRequestId:string(1–64)}`；补发增加 `{fulfillmentId:UUID,quantityGrams:positive integer(最小计量单位),company:string≤30,trackingNo:string≤64}`。返回202 `{request:ActionRequest}`，同键同内容恢复，同键异内容409。

GET `/api/admin/v1/after-sales/tickets/:id/requests`，同工单权限，→200 `{items:ActionRequest[]}`；用户工单详情增加去除申请人/审核人ID的申请状态及结果。视图 `{id,ticketId,orderId,kind,status,reason,payload,amountFen,requesterId,reviewerId,reviewReason,resultId,createdAt,reviewedAt}`，金额由支付事实提供、ISO时间，pending/executed/rejected。

POST `/api/admin/v1/after-sales/requests/:id/review` 仅 admin:manage（super_admin），`{decision:approve|reject,reason:string(1–1000)}` →200 `{request}`。并发审批按申请锁串行化，同决定同审核原因重复返回原结果，不同决定409。通过退款创建 after_sales 原因退款单、关联工单、停止后续履约；不以渠道受理/到账冒充执行请求成功。通过补发追加包裹，不修改正常发货进度；输入资格在执行时再验证。数据库/action/审计失败全部回滚且保持pending，恢复后同请求重试可成功。

POST `/api/admin/v1/fulfillment/blocks/:groupId/orders/:orderId/refund-request` 需 agent:manage；必须真实零分配异常、订单属于该组且具有有效支付。`{reason,clientRequestId}` →202创建并受理异常工单、待审核退款申请；重复键不重复建工单。后台异常列表逐单提供入口。

权限来源仅可信后端 principal。越权404/403；参数400；状态/幂等/资格409。不可用渠道不阻止创建请求，但退款到账未完成如实展示；渠道失败沿用 T006 重试及人工处理。

- AP01 普通客服仅提交申请，没有退款/包裹事实，不能审核。
- AP02 超级管理员批准成功组退款按实付全额、after_sales原因，不修改成功组/历史数量；重复/并发审核恰一个结果。
- AP03 拒绝只记记录；不同决定重复冲突。
- AP04 工单归属、订单绑定、履约归属与资格独立验证，退款累计受限。
- AP05 action/审计失败退款、停止记录、审核结果同事务回滚；补发同理。
- AP06 补发任意原状态可批准，原因/数量/运单合法、正常进度不变；退款停止后不能新增履约/包裹。
- AP07 历史零分配组按订单申请，原快照不变，审核前不退款。
- AP08 两端展示申请、审核原因、请求结果和渠道结果区别，后台真实申请/审核操作验证。

页面补发选项由 GET `/api/admin/v1/after-sales/tickets/:id/fulfillment` 提供（agent:manage、工单归属检查），返回 `{fulfillment:null|{id,unit,allocatedQuantityGrams,shippedQuantityGrams,status,refundHeld}}`，不包含收货地址。原履约发货接口仅处理正常发货，`isReissue:true` 返回409 `REVIEW_REQUIRED`，补发必须使用上述审核流程，防止绕过 D020。后台通过工单链接定位异常申请；补发数量上限为 PostgreSQL integer 最大值 2147483647。

补发原因沿用现有包裹字段最多200字，申请阶段400拒绝超界，防止先接受申请而审批写包裹时500。退款及审核意见仍最多1000字。
