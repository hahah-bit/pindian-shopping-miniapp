import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{createRequire}from'node:module';const require=createRequire(import.meta.url);
const{PostgresFulfillmentRepository}=require('../../../backend/dist/contexts/fulfillment/adapters/outbound/postgres/fulfillment-repository.js');
const{FulfillmentGenerationTask}=require('../../../backend/dist/workflows/fulfillment-generation.task.js');
export async function approvalPgScenarios({db,base,superAuth,staffAuth,loserAuth,userAuth,otherUserAuth,userId,productId,templateOrder,pool}){
  async function http(path,body,headers=superAuth,status=200){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const json=await r.json();assert.equal(r.status,status,JSON.stringify(json));return json.data;}
  const runner={async run(work){const c=await pool.connect();try{await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
  const repo=new PostgresFulfillmentRepository(pool),generation=new FulfillmentGenerationTask({scan:repo,fulfillmentOrders:repo,runner,clock:{now:()=>new Date()}});
  async function seedGroup(quantity,unit,shares){const group=randomUUID();await db.query("INSERT INTO groups(id,product_id,sale_policy_snapshot,deadline,status,paid_units,paid_amount_fen,paid_goods_amount_fen) VALUES($1,$2,$3,now()+interval '1 day','success',60,50500,50000)",[group,productId,JSON.stringify({originalPriceFen:50000,userWholePriceFen:50500,allowedShareUnits:shares,wholeQuantityText:quantity,unit})]);
    const orders=[];let assigned=0,goodsAssigned=0;
    for(let i=0;i<shares.length;i++){const id=randomUUID(),units=shares[i],total=i===shares.length-1?50500-assigned:Math.floor(50500*units/60),goods=i===shares.length-1?50000-goodsAssigned:Math.floor(50000*units/60);assigned+=total;goodsAssigned+=goods;
      await db.query("INSERT INTO orders(id,order_no,user_id,product_id,group_id,units,status,total_amount_fen,goods_amount_fen,service_fee_fen,is_final_order,original_price_fen,unit,whole_quantity_text,reference_quantity_text,address_receiver_name,address_phone,address_province,address_city,address_district,address_detail,idempotency_key,reservation_expires_at,paid_at,created_at) SELECT $1,$2,user_id,product_id,$3,$4,status,$5,$6,$7,$8,original_price_fen,$9,$10,$10,address_receiver_name,address_phone,address_province,address_city,address_district,address_detail,$11,reservation_expires_at,paid_at,now()+($12::int*interval '1 second') FROM orders WHERE id=$13",[id,'APP-'+id.slice(0,20),group,units,total,goods,total-goods,i===shares.length-1,unit,quantity,randomUUID(),i,templateOrder]);
      await db.query("INSERT INTO payments(id,order_id,user_id,amount_fen,status,out_trade_no,applied_result) VALUES($1,$2,$3,$4,'succeeded',$5,'applied')",[randomUUID(),id,userId,total,'APP-'+id.slice(0,20)]);orders.push({id,total});
    }return {group,orders};
  }
  async function ownedTicket(order){const t=(await http('/mini/v1/tickets',{type:'shipment_issue',title:'审批真实集成',description:'售后凭证已核实',orderId:order,clientTicketId:randomUUID()},userAuth,201)).ticket.id;await http('/admin/v1/after-sales/tickets/'+t+'/accept',{},staffAuth);return t;}
  const valid=await seedGroup('10','斤',[30,30]);await generation.execute({limit:100});
  const first=valid.orders[0],second=valid.orders[1],fid=(await repo.findByOrderId(first.id)).state.fulfillmentOrderId,secondFid=(await repo.findByOrderId(second.id)).state.fulfillmentOrderId;
  const t=await ownedTicket(first.id),refundPath='/admin/v1/after-sales/tickets/'+t+'/refund',refundBody={orderId:first.id,reason:'核实退款',clientRequestId:'success-refund'};
  const summary=(await http('/admin/v1/after-sales/tickets/'+t+'/fulfillment',undefined,staffAuth)).fulfillment;assert.equal(summary.id,fid);assert.equal(summary.allocatedQuantityGrams,2500);assert.equal('receiver' in summary,false);
  await http('/admin/v1/after-sales/tickets/'+t+'/fulfillment',undefined,loserAuth,404);
  const pending=(await http(refundPath,refundBody,staffAuth,202)).request;
  assert.equal((await db.query('SELECT COUNT(*)::int c FROM refunds WHERE order_id=$1',[first.id])).rows[0].c,0);
  await http('/admin/v1/after-sales/requests/'+pending.id+'/review',{decision:'approve',reason:'批准'},staffAuth,403);
  // 不同超级管理员同时批准，同一个请求仅产生一个资金指令。
  await db.query("INSERT INTO admins(id,username,display_name,password_hash,role,status) SELECT $1,'reviewer2','审核员2',password_hash,'super_admin','active' FROM admins WHERE username='agent1'",[randomUUID()]);
  const login=await http('/admin/v1/auth/login',{username:'reviewer2',password:'agent1-pass'}, {'Content-Type':'application/json'});
  const secondSuper={'Content-Type':'application/json',Authorization:'Bearer '+login.token},reviewBody={decision:'approve',reason:'批准'};
  const decisions=await Promise.all([http('/admin/v1/after-sales/requests/'+pending.id+'/review',reviewBody),http('/admin/v1/after-sales/requests/'+pending.id+'/review',reviewBody,secondSuper)]);
  assert.equal(decisions[0].request.resultId,decisions[1].request.resultId);
  const refund=(await db.query('SELECT amount_fen,reason,status FROM refunds WHERE order_id=$1',[first.id])).rows;assert.equal(refund.length,1);assert.equal(refund[0].amount_fen,first.total);assert.equal(refund[0].reason,'after_sales');assert.equal(refund[0].status,'requested');
  assert.equal((await db.query("SELECT COUNT(*)::int c FROM after_sales_ticket_actions WHERE ticket_id=$1 AND action='approve_refund'",[t])).rows[0].c,1);
  assert.equal((await db.query("SELECT COUNT(*)::int c FROM admin_operation_logs WHERE resource_id=$1 AND action='ticket.approve_refund'",[pending.id])).rows[0].c,1);
  assert.deepEqual((await db.query('SELECT status,paid_units FROM groups WHERE id=$1',[valid.group])).rows[0],{status:'success',paid_units:60});
  await http('/admin/v1/fulfillment/orders/'+fid+'/shipments',{quantityGrams:1,company:'顺丰',trackingNo:'REFUND-HOLD'},superAuth,409);
  await http('/admin/v1/after-sales/tickets/'+t+'/reshipment',{orderId:first.id,fulfillmentId:fid,quantityGrams:1,company:'顺丰',trackingNo:'HOLD-RESEND',clientRequestId:randomUUID(),reason:'退款后尝试'},staffAuth,409);
  const userView=await http('/mini/v1/tickets/'+t,undefined,userAuth);assert.equal(userView.requests[0].status,'executed');assert.equal('requesterId' in userView.requests[0],false);
  await http('/mini/v1/tickets/'+t,undefined,otherUserAuth,404);
  // completed 履约单补发：正常进度不变，包裹和审核记录同事务。
  await http('/admin/v1/fulfillment/orders/'+secondFid+'/shipments',{quantityGrams:2500,company:'顺丰',trackingNo:'APP-NORMAL'},superAuth,201);
  await http('/admin/v1/fulfillment/orders/'+secondFid+'/complete',{});
  const t2=await ownedTicket(second.id),reship=(await http('/admin/v1/after-sales/tickets/'+t2+'/reshipment',{orderId:second.id,fulfillmentId:secondFid,quantityGrams:100,company:'顺丰',trackingNo:'APP-RESEND',reason:'凭证补寄',clientRequestId:'reship-request'},staffAuth,202)).request;
  assert.equal((await db.query('SELECT count(*)::int c FROM shipments WHERE fulfillment_order_id=$1',[secondFid])).rows[0].c,1);
  await db.query("CREATE FUNCTION reject_approval_reship_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ticket.approve_reshipment' THEN RAISE EXCEPTION 'test approval audit failure'; END IF; RETURN NEW; END; $$");
  await db.query('CREATE TRIGGER reject_approval_reship_audit BEFORE INSERT ON admin_operation_logs FOR EACH ROW EXECUTE FUNCTION reject_approval_reship_audit()');
  const route='/admin/v1/after-sales/requests/'+reship.id+'/review';await http(route,reviewBody,superAuth,500);
  assert.equal((await db.query('SELECT status FROM after_sales_action_requests WHERE id=$1',[reship.id])).rows[0].status,'pending');assert.equal((await db.query('SELECT count(*)::int c FROM shipments WHERE fulfillment_order_id=$1',[secondFid])).rows[0].c,1);
  await db.query('DROP TRIGGER reject_approval_reship_audit ON admin_operation_logs');
  const approved=(await http(route,reviewBody)).request;assert.equal((await http(route,reviewBody)).request.resultId,approved.resultId);
  assert.deepEqual((await db.query('SELECT status,shipped_quantity_grams FROM fulfillment_orders WHERE id=$1',[secondFid])).rows[0],{status:'completed',shipped_quantity_grams:2500});
  assert.equal((await db.query('SELECT count(*)::int c FROM shipments WHERE fulfillment_order_id=$1 AND is_reissue',[secondFid])).rows[0].c,1);
  // 历史零分配整组暂停；逐单审查退款不改原数量。
  const zero=await seedGroup('3','件',[30,15,15]);await generation.execute({limit:100});
  assert.equal((await db.query('SELECT reason FROM fulfillment_blocks WHERE group_id=$1',[zero.group])).rows[0].reason,'ZERO_ALLOCATION');
  assert.equal((await db.query('SELECT count(*)::int c FROM fulfillment_orders WHERE group_id=$1',[zero.group])).rows[0].c,0);
  const anomalyPath='/admin/v1/fulfillment/blocks/'+zero.group+'/orders/'+zero.orders[2].id+'/refund-request',anomalyBody={reason:'历史异常全额退款',clientRequestId:'zero-request'};
  const anomaly=(await http(anomalyPath,anomalyBody,staffAuth,202)).request;assert.equal((await http(anomalyPath,anomalyBody,staffAuth,202)).request.id,anomaly.id);
  assert.equal((await db.query('SELECT count(*)::int c FROM refunds WHERE order_id=$1',[zero.orders[2].id])).rows[0].c,0);
  await http('/admin/v1/after-sales/requests/'+anomaly.id+'/review',reviewBody);
  assert.equal((await db.query('SELECT amount_fen FROM refunds WHERE order_id=$1',[zero.orders[2].id])).rows[0].amount_fen,zero.orders[2].total);
  assert.equal((await db.query('SELECT sale_policy_snapshot FROM groups WHERE id=$1',[zero.group])).rows[0].sale_policy_snapshot.wholeQuantityText,'3');
  // 审核发生在首次生成之前：退款订单跳过，其他订单保持原分配，无重分历史尾差。
  const before=await seedGroup('10','斤',[30,30]),beforeTicket=await ownedTicket(before.orders[0].id);
  const beforeReq=(await http('/admin/v1/after-sales/tickets/'+beforeTicket+'/refund',{orderId:before.orders[0].id,reason:'首次生成前退款',clientRequestId:'before-gen'},staffAuth,202)).request;
  await http('/admin/v1/after-sales/requests/'+beforeReq.id+'/review',reviewBody);await generation.execute({limit:100});
  assert.equal(await repo.findByOrderId(before.orders[0].id),null);assert.equal((await repo.findByOrderId(before.orders[1].id)).state.allocatedQuantityGrams,2500);
}
