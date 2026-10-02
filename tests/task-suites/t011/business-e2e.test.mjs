import test from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{localStack,product,order,pay,eventually}from'../../helpers/local-stack.mjs';
async function users(s){const result=[];for(const name of ['alice','bob','charlie']){const u=await s.login(name);u.address=await s.address(u.token);result.push(u);}return result;}
async function agent(s){const id=randomUUID();await s.db.query(`INSERT INTO admins(id,username,display_name,password_hash,role,status) SELECT $1,'demo-agent','本地客服',password_hash,'cs_agent','active' FROM admins WHERE username='demo-super'`,[id]);const r=await s.http('/admin/v1/auth/login',{method:'POST',body:{username:'demo-agent',password:'TestOnly-2026!'}});return r.token;}
async function ticket(s,user,orderId,token){const r=await s.http('/mini/v1/tickets',{token:user.token,method:'POST',status:201,body:{type:'other',title:'本地售后',description:'全流程验收',orderId,clientTicketId:randomUUID()}});await s.http(`/admin/v1/after-sales/tickets/${r.ticket.id}/accept`,{token,method:'POST',body:{clientActionId:randomUUID()}});return r.ticket.id;}
async function finishRefund(s,orderId){const r=await eventually(async()=>{const r=(await s.db.query('SELECT * FROM refunds WHERE order_id=$1',[orderId])).rows[0];return r?.status==='processing'?r:null;});await s.control({action:'refund-state',outRefundNo:r.out_refund_no,status:'SUCCESS'});const result=await s.control({action:'notify-refund',outRefundNo:r.out_refund_no,repeats:2});assert.ok(result.callbackStatuses.every(x=>[200,204].includes(x)));return r;}

test('F045 商品→混合支付顺序→分份履约→客服→审核退款补发→通知看板审计',async(t)=>{
 const s=await localStack(t,'t011'),u=await users(s),p=await product(s),cs=await agent(s);const orders=[];for(const user of u)orders.push(await order(s,user,p,20));
 assert.equal(orders.reduce((a,o)=>a+o.quote.totalAmountFen,0),1500);for(const i of [1,0,2])await pay(s,u[i],orders[i].id);
 let worker=s.startWorker();const fulfill=await eventually(async()=>{const r=await s.db.query('SELECT * FROM fulfillment_orders WHERE group_id=$1 ORDER BY created_at,id',[orders[0].groupId]);return r.rows.length===3?r.rows:null;});
 assert.equal(fulfill.reduce((a,f)=>a+f.allocated_quantity_grams,0),5000);assert.ok(fulfill.every(f=>f.allocated_quantity_grams>0)); const settlement=(await s.db.query('SELECT * FROM group_settlements WHERE group_id=$1',[orders[0].groupId])).rows[0]; assert.equal(settlement.settled_total_fen+settlement.diff_fen,1501);assert.equal(settlement.diff_fen,1);
 const f0=fulfill.find(f=>f.order_id===orders[0].id),f1=fulfill.find(f=>f.order_id===orders[1].id);
 const receiver={receiverName:'新收货人',phone:'13800000001',province:'广东省',city:'深圳市',district:'南山区',detail:'版本二地址'};
 const updated=await s.http(`/admin/v1/fulfillment/orders/${f0.id}/receiver`,{token:s.superToken,method:'POST',status:201,body:receiver});assert.equal(updated.fulfillmentOrder.receiverVersion,2);
 const ship=await s.http(`/admin/v1/fulfillment/orders/${f0.id}/shipments`,{token:s.superToken,method:'POST',status:201,body:{quantityGrams:100,company:'模拟快递',trackingNo:'LOCAL-PARTIAL-1'}});assert.equal(ship.fulfillmentOrder.status,'partially_shipped');
 const locked=await s.http(`/admin/v1/fulfillment/orders/${f0.id}/receiver`,{token:s.superToken,method:'POST',status:409,body:receiver});assert.equal(locked.code,'RECEIVER_LOCKED');
 await s.http('/admin/v1/cs/heartbeat',{token:cs,method:'POST'});const conv=await s.http('/mini/v1/conversations',{token:u[0].token,method:'POST',status:201});await s.http(`/mini/v1/conversations/${conv.conversation.id}/messages`,{token:u[0].token,method:'POST',status:201,body:{clientMessageId:randomUUID(),kind:'text',content:{text:'需要售后'}}});
 assert.equal(conv.conversation.hasAgent,true);await s.http(`/admin/v1/cs/conversations/${conv.conversation.id}/messages`,{token:cs,method:'POST',status:201,body:{clientMessageId:randomUUID(),kind:'text',content:{text:'已收到'}}});
 const ticket0=await ticket(s,u[0],orders[0].id,cs);const requested=await s.http(`/admin/v1/after-sales/tickets/${ticket0}/reshipment`,{token:cs,method:'POST',status:202,body:{orderId:orders[0].id,fulfillmentId:f0.id,quantityGrams:50,company:'模拟快递',trackingNo:'LOCAL-REISSUE-1',reason:'补寄',clientRequestId:randomUUID()}});assert.equal(requested.request.status,'pending');
 await s.http(`/admin/v1/after-sales/requests/${requested.request.id}/review`,{token:cs,method:'POST',status:403,body:{decision:'approve',reason:'越权'}});
 const reship=await s.http(`/admin/v1/after-sales/requests/${requested.request.id}/review`,{token:s.superToken,method:'POST',body:{decision:'approve',reason:'审核补发'}});assert.equal(reship.request.status,'executed');
 assert.equal((await s.db.query('SELECT shipped_quantity_grams FROM fulfillment_orders WHERE id=$1',[f0.id])).rows[0].shipped_quantity_grams,100);
 await s.http(`/admin/v1/fulfillment/orders/${f0.id}/shipments`,{token:s.superToken,method:'POST',status:409,body:{quantityGrams:50,company:'模拟快递',trackingNo:'BYPASS',isReissue:true}});
 const ticket1=await ticket(s,u[1],orders[1].id,cs);const request=await s.http(`/admin/v1/after-sales/tickets/${ticket1}/refund`,{token:cs,method:'POST',status:202,body:{orderId:orders[1].id,reason:'退款申请',clientRequestId:randomUUID()}});
 const approved=await s.http(`/admin/v1/after-sales/requests/${request.request.id}/review`,{token:s.superToken,method:'POST',body:{decision:'approve',reason:'审核全额退款'}});assert.equal(approved.request.status,'executed');const refund=await finishRefund(s,orders[1].id);assert.equal(refund.amount_fen,orders[1].quote.totalAmountFen);
 const held=await s.http(`/admin/v1/fulfillment/orders/${f1.id}/shipments`,{token:s.superToken,method:'POST',status:409,body:{quantityGrams:10,company:'模拟快递',trackingNo:'HELD'}});assert.ok(held.code);
 await s.stop(worker);worker=s.startWorker();await eventually(async()=>{const n=await s.http('/mini/v1/notifications',{token:u[1].token});return n.items.some(x=>x.eventType==='refund.succeeded')?n:null;});
 assert.equal((await s.db.query(`SELECT count(*)::int c FROM fulfillment_orders WHERE group_id=$1`,[orders[0].groupId])).rows[0].c,3,'Worker重启不重复履约');
 const reporting=await s.http('/admin/v1/reporting/overview',{token:s.superToken});assert.equal(reporting.overview.successGroups,1);assert.equal(reporting.overview.refundSucceededFen,refund.amount_fen);
 const notices=await s.http('/mini/v1/notifications',{token:u[1].token});const notice=notices.items.find(x=>x.eventType==='refund.succeeded');await s.http(`/mini/v1/notifications/${notice.id}/read`,{token:u[1].token,method:'POST'});await s.http(`/mini/v1/notifications/${notice.id}/read`,{token:u[0].token,method:'POST',status:404});
 await s.http('/admin/v1/audit/logs',{token:cs,status:403});const audit=await s.http('/admin/v1/audit/logs?action=ticket.approve',{token:s.superToken});assert.equal(audit.total,2);
});

test('F045 到期/预占释放/拼单失败/迟到支付退款及Worker恢复',async(t)=>{
 const s=await localStack(t,'t011'),u=await users(s),p=await product(s,{allowedShareUnits:[30]});const a=await order(s,u[0],p,30),b=await order(s,u[1],p,30);await pay(s,u[0],a.id);await s.http(`/mini/v1/orders/${b.id}/pay`,{token:u[1].token,method:'POST',status:201});
 await s.db.query(`UPDATE share_reservations SET expires_at=now()-interval '1 minute' WHERE order_id=$1`,[b.id]);await s.db.query(`UPDATE groups SET deadline=now()-interval '1 minute' WHERE id=$1`,[a.groupId]);
 s.startWorker();await eventually(async()=>{const g=(await s.db.query('SELECT status FROM groups WHERE id=$1',[a.groupId])).rows[0];return g.status==='failed';});
 await finishRefund(s,a.id);const stock=(await s.db.query('SELECT * FROM stocks WHERE product_id=$1',[p.id])).rows[0];assert.equal(stock.reserved_whole_items,0);assert.equal(stock.available_whole_items,10);
 const no=(await s.db.query('SELECT out_trade_no FROM payments WHERE order_id=$1',[b.id])).rows[0].out_trade_no;await s.control({action:'payment-state',outTradeNo:no,tradeState:'SUCCESS'});const late=await s.control({action:'notify-payment',outTradeNo:no,repeats:2});assert.ok(late.callbackStatuses.every(x=>[200,204].includes(x)));const refund=await finishRefund(s,b.id);assert.equal(refund.amount_fen,b.quote.totalAmountFen);assert.equal((await s.db.query('SELECT status FROM groups WHERE id=$1',[a.groupId])).rows[0].status,'failed');
 assert.equal((await s.db.query('SELECT count(*)::int c FROM refunds WHERE order_id=$1',[b.id])).rows[0].c,1);
});

test('F045 禁止零分配与历史异常暂停、审核退款，不改历史数量',async(t)=>{
 const s=await localStack(t,'t011'),u=await users(s),p=await product(s,{unit:'个',wholeQuantity:'10',allowedShareUnits:[30]});
 const mainImageId=(await s.db.query("SELECT media_asset_id FROM product_images WHERE product_id=$1 AND role='main'",[p.id])).rows[0].media_asset_id;
 const invalid=await s.http('/admin/v1/products',{token:s.superToken,method:'POST',status:201,body:{name:'零分配非法',unit:'个',wholeQuantity:'1',originalPriceFen:1000,allowedShareUnits:[30],mainImageId,initialStockWholeItems:1}});
 const rejected=await s.http(`/admin/v1/products/${invalid.id}/publish`,{token:s.superToken,method:'POST',status:409});assert.ok(rejected.code);
 const a=await order(s,u[0],p,30),b=await order(s,u[1],p,30);await pay(s,u[0],a.id);await pay(s,u[1],b.id);
 // 唯一业务数据探针：构造迁移前历史非法数量；保留金额/支付事实，运行真实Worker处置。
 await s.db.query(`UPDATE groups SET sale_policy_snapshot=jsonb_set(sale_policy_snapshot,'{wholeQuantityText}','"1"') WHERE id=$1`,[a.groupId]);const before=(await s.db.query('SELECT sale_policy_snapshot FROM groups WHERE id=$1',[a.groupId])).rows[0].sale_policy_snapshot;
 s.startWorker();await eventually(async()=>{const r=await s.db.query('SELECT reason FROM fulfillment_blocks WHERE group_id=$1',[a.groupId]);return r.rows[0]?.reason==='ZERO_ALLOCATION';});assert.equal((await s.db.query('SELECT count(*)::int c FROM fulfillment_orders WHERE group_id=$1',[a.groupId])).rows[0].c,0);
 const requested=await s.http(`/admin/v1/fulfillment/blocks/${a.groupId}/orders/${a.id}/refund-request`,{token:s.superToken,method:'POST',status:202,body:{reason:'历史异常',clientRequestId:randomUUID()}});await s.http(`/admin/v1/after-sales/requests/${requested.request.id}/review`,{token:s.superToken,method:'POST',body:{decision:'approve',reason:'审核异常退款'}});await finishRefund(s,a.id);
 assert.deepEqual((await s.db.query('SELECT sale_policy_snapshot FROM groups WHERE id=$1',[a.groupId])).rows[0].sale_policy_snapshot,before);
});
