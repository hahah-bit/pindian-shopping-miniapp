import {randomUUID,randomBytes,createCipheriv,sign,verify} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export function createPaymentHandler(config){
 const orders=new Map(),refunds=new Map(),failures=new Set();
 if(config.stateFile&&existsSync(config.stateFile)){const saved=JSON.parse(readFileSync(config.stateFile,'utf8'));if(saved.version!==1||!Array.isArray(saved.orders)||!Array.isArray(saved.refunds))throw Error('模拟渠道持久化损坏');for(const[k,v]of saved.orders)orders.set(k,v);for(const[k,v]of saved.refunds)refunds.set(k,v);}
 const signed=(raw)=>{const timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(12).toString('hex');return {'wechatpay-serial':'simulation-platform','wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-signature':sign('RSA-SHA256',Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),config.platformPrivateKey).toString('base64')};};
 const notification=(kind,id)=>{
  const row=(kind==='payment'?orders:refunds).get(id);if(!row)throw Error('not_found');
  const fact=kind==='payment'?{mchid:config.mchid,appid:config.appid,out_trade_no:id,transaction_id:row.transaction_id,trade_state:row.trade_state,amount:{payer_total:row.total},success_time:row.success_time??new Date().toISOString()}:{mchid:config.mchid,out_refund_no:id,out_trade_no:row.out_trade_no,refund_id:row.refund_id,refund_status:row.status,amount:{refund:row.refund,total:row.total}};
  const nonce=randomBytes(6).toString('hex'),aad=kind;const cipher=createCipheriv('aes-256-gcm',Buffer.from(config.apiV3Key),Buffer.from(nonce));cipher.setAAD(Buffer.from(aad));const encrypted=Buffer.concat([cipher.update(JSON.stringify(fact)),cipher.final(),cipher.getAuthTag()]);
  const event_type=kind==='payment'?'TRANSACTION.SUCCESS':`REFUND.${row.status}`;
  const raw=JSON.stringify({id:randomUUID(),event_type,resource:{algorithm:'AEAD_AES_256_GCM',ciphertext:encrypted.toString('base64'),nonce,associated_data:aad}});return{raw,headers:signed(raw)};
 };
 const handle=async({control,body,raw,url,req})=>{
  const ok=(body)=>({status:200,body}),error=(status,code)=>({status,body:{code,message:'本地模拟渠道错误'}});
  if(control){
   if(body.action==='failure'){if(!['jsapi','query','close','refund','refund-query'].includes(body.operation)||typeof body.enabled!=='boolean')return error(400,'INVALID_CONTROL');body.enabled?failures.add(body.operation):failures.delete(body.operation);return ok({enabled:body.enabled});}
   if(body.action==='payment-state'){
    const o=orders.get(body.outTradeNo);if(!o)return error(404,'NOT_FOUND');if(!['SUCCESS','NOTPAY','CLOSED'].includes(body.tradeState))return error(400,'INVALID_CONTROL');
    o.trade_state=body.tradeState;if(body.tradeState==='SUCCESS')o.success_time=new Date().toISOString();return ok({tradeState:o.trade_state});
   }
   if(body.action==='refund-state'){const r=refunds.get(body.outRefundNo);if(!r)return error(404,'NOT_FOUND');if(!['PROCESSING','SUCCESS','ABNORMAL','CLOSED'].includes(body.status))return error(400,'INVALID_CONTROL');r.status=body.status;return ok({status:r.status});}
   if(['notify-payment','notify-refund'].includes(body.action)){
    const kind=body.action==='notify-payment'?'payment':'refund',id=kind==='payment'?body.outTradeNo:body.outRefundNo;
    if(!(kind==='payment'?orders:refunds).has(id))return error(404,'NOT_FOUND');
    if(kind==='payment'&&orders.get(id).trade_state!=='SUCCESS')return error(409,'NOT_PAID');
    const repeats=body.repeats??1;if(!Number.isInteger(repeats)||repeats<1||repeats>3||!config.notifyUrl)return error(400,'INVALID_CONTROL');
    const packet=notification(kind,id),statuses=[];
    for(let i=0;i<repeats;i++){const r=await fetch(config.notifyUrl,{method:'POST',headers:{...packet.headers,'Content-Type':'application/json'},body:packet.raw+(body.tamper?' ':''),signal:AbortSignal.timeout(10000)});statuses.push(r.status);await r.text();}
    return ok({callbackStatuses:statuses});
   }
   return null;
  }
  if(!url.pathname.startsWith('/v3/'))return null;
  const fields=Object.fromEntries([...String(req.headers.authorization??'').matchAll(/([a-z_]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  const message=`${req.method}\n${url.pathname+url.search}\n${fields.timestamp}\n${fields.nonce_str}\n${raw}\n`;
  let valid=false;try{valid=fields.mchid===config.mchid&&Math.abs(Date.now()/1000-Number(fields.timestamp))<300&&verify('RSA-SHA256',Buffer.from(message),config.merchantPublicKey,Buffer.from(fields.signature??'','base64'));}catch{}
  if(!valid)return error(401,'SIGN_ERROR');
  if(req.method==='POST'&&url.pathname==='/v3/pay/transactions/jsapi'){
   if(failures.has('jsapi'))return error(500,'SYSTEM_ERROR');
   if(body.appid!==config.appid||body.mchid!==config.mchid||!Number.isSafeInteger(body.amount?.total)||body.amount.total<1||!body.payer?.openid||typeof body.out_trade_no!=='string')return error(400,'INVALID_REQUEST');
   const old=orders.get(body.out_trade_no);if(old&&(old.total!==body.amount.total||old.openid!==body.payer.openid))return error(409,'ORDER_CONFLICT');
   if(!old)orders.set(body.out_trade_no,{total:body.amount.total,openid:body.payer.openid,trade_state:'NOTPAY',prepay_id:`sim-${body.out_trade_no}`,transaction_id:`sim-tx-${randomUUID()}`});
   return ok({prepay_id:orders.get(body.out_trade_no).prepay_id});
  }
  if(url.pathname.startsWith('/v3/pay/transactions/out-trade-no/')){
   const id=decodeURIComponent(url.pathname.split('/')[5]),o=orders.get(id);if(!o)return error(404,'ORDER_NOT_EXIST');
   if(req.method==='POST'&&url.pathname.endsWith('/close')){if(failures.has('close'))return error(500,'SYSTEM_ERROR');if(o.trade_state==='SUCCESS')return error(409,'ORDER_PAID');o.trade_state='CLOSED';return ok({});}
   if(failures.has('query'))return error(500,'SYSTEM_ERROR');return ok({trade_state:o.trade_state,transaction_id:o.trade_state==='SUCCESS'?o.transaction_id:undefined,amount:{payer_total:o.total}});
  }
  if(req.method==='POST'&&url.pathname==='/v3/refund/domestic/refunds'){
   if(failures.has('refund'))return error(500,'SYSTEM_ERROR');const o=orders.get(body.out_trade_no),old=refunds.get(body.out_refund_no);
   if(old){if(old.out_trade_no!==body.out_trade_no||old.refund!==body.amount?.refund)return error(409,'REFUND_CONFLICT');return ok({status:old.status,refund_id:old.refund_id});}
   const used=[...refunds.values()].filter(r=>r.out_trade_no===body.out_trade_no&&r.status!=='CLOSED').reduce((a,r)=>a+r.refund,0);
   if(!o||o.trade_state!=='SUCCESS'||!Number.isSafeInteger(body.amount?.refund)||body.amount.refund<=0||body.amount.total!==o.total||used+body.amount.refund>o.total)return error(400,'INVALID_REFUND');
   const r={out_trade_no:body.out_trade_no,total:o.total,refund:body.amount.refund,status:'PROCESSING',refund_id:`sim-refund-${randomUUID()}`};refunds.set(body.out_refund_no,r);return ok({status:r.status,refund_id:r.refund_id});
  }
  if(req.method==='GET'&&url.pathname.startsWith('/v3/refund/domestic/refunds/')){if(failures.has('refund-query'))return error(500,'SYSTEM_ERROR');const r=refunds.get(decodeURIComponent(url.pathname.split('/')[5]));return r?ok({status:r.status,refund_id:r.refund_id}):error(404,'REFUND_NOT_EXIST');}
  return error(404,'NOT_FOUND');
 };
 const handler=async(input)=>{const result=await handle(input);if(config.stateFile&&result?.status===200&&(input.control||input.req.method==='POST')){mkdirSync(dirname(config.stateFile),{recursive:true});writeFileSync(config.stateFile+'.tmp',JSON.stringify({version:1,orders:[...orders],refunds:[...refunds]}));renameSync(config.stateFile+'.tmp',config.stateFile);}return result;};
 handler.notification=notification;handler.orders=orders;handler.refunds=refunds;handler.signResponse=signed;return handler;
}
