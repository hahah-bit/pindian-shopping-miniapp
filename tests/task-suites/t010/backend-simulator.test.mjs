import test from 'node:test';import assert from 'node:assert/strict';import{localStack,product,order,pay,eventually}from'../../helpers/local-stack.mjs';
test('T010 真实后端/PG接模拟身份支付退款：回调不改报价、拒绝篡改',async(t)=>{
 const s=await localStack(t,'t010');const a=await s.login('alice');a.address=await s.address(a.token);const p=await product(s);const placed=await order(s,a,p,30);const o=placed.order??placed;
 assert.equal(o.status,'unpaid');const no=await pay(s,a,o.id);const result=await s.http(`/mini/v1/orders/${o.id}/payment-result`,{token:a.token,method:'POST'});assert.equal(result.status,'paid');
 const tampered=await s.control({action:'notify-payment',outTradeNo:no,tamper:true});assert.ok(tampered.callbackStatuses.every(x=>x>=400));
 const codes=await s.control({action:'phone-code',user:'alice'});await s.http('/mini/v1/auth/phone',{token:a.token,method:'POST',body:{code:codes.code}});
 const cancelled=await s.http(`/mini/v1/orders/${o.id}/cancel`,{token:a.token,method:'POST'});assert.ok(cancelled);
 s.startWorker();const refund=await eventually(async()=>{const r=(await s.db.query('SELECT * FROM refunds WHERE order_id=$1',[o.id])).rows[0];return r?.status==='processing'?r:null;});
 assert.equal(refund.amount_fen,o.quote.totalAmountFen);
 await s.control({action:'refund-state',outRefundNo:refund.out_refund_no,status:'SUCCESS'});const notified=await s.control({action:'notify-refund',outRefundNo:refund.out_refund_no,repeats:2});assert.ok(notified.callbackStatuses.every(x=>[200,204].includes(x)));
 assert.equal((await s.db.query('SELECT status FROM refunds WHERE id=$1',[refund.id])).rows[0].status,'succeeded');assert.equal((await s.db.query('SELECT count(*)::int c FROM refunds WHERE order_id=$1',[o.id])).rows[0].c,1);
});
