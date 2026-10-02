import assert from 'node:assert/strict';
import{readFileSync,mkdtempSync,writeFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{resolve,join}from'node:path';import{parseEnv}from'node:util';import{spawn,spawnSync}from'node:child_process';import{createServer}from'node:net';import{randomUUID,generateKeyPairSync}from'node:crypto';import{deflateSync}from'node:zlib';import pg from'pg';
import{startSimulator}from'../../infra/simulation/server.mjs';import{createPaymentHandler}from'../../infra/simulation/payment.mjs';
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function eventually(work,timeout=15000){const until=Date.now()+timeout;let last;do{try{const r=await work();if(r)return r;}catch(e){last=e;}await delay(100);}while(Date.now()<until);throw last??Error('条件未在期限内成立');}
async function unusedPort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
export async function localStack(t,label){
 const local=parseEnv(readFileSync('.env','utf8'));const admin=new pg.Client({connectionString:process.env.PINDIAN_TEST_DATABASE_URL??local.DATABASE_URL});await admin.connect();
 const name=`pindian_${label}_${randomUUID().replaceAll('-','').slice(0,12)}`;assert.match(name,/^pindian_t01[01]_[a-f0-9]{12}$/);
 const temp=mkdtempSync(join(tmpdir(),'pindian-local-'));const children=[];let db,sim;
 const stop=async(child)=>{if(!child||child.exitCode!==null)return;child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),delay(3000)]);if(child.exitCode===null)child.kill('SIGKILL');};
 t.after(async()=>{for(const c of children)await stop(c);if(sim)await sim.close();if(db)await db.end();await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();assert.ok(resolve(temp).startsWith(resolve(tmpdir())+'\\pindian-local-')||resolve(temp).startsWith(resolve(tmpdir())+'/pindian-local-'));rmSync(temp,{recursive:true,force:true});});
 await admin.query(`CREATE DATABASE ${name}`);const url=new URL(process.env.PINDIAN_TEST_DATABASE_URL??local.DATABASE_URL);url.pathname='/'+name;
 const env={...process.env,APP_ENV:'simulation',DATABASE_URL:url.href,MEDIA_DIR:join(temp,'media'),WX_APPID:'simulation-appid',WX_APP_SECRET:'simulation-secret',WX_PAY_MCHID:'simulation-mchid',WX_PAY_APIV3_KEY:'12345678901234567890123456789012',WX_PAY_SERIAL_NO:'simulation-merchant',WORKER_HEALTH_DIR:join(temp,'worker')};
 const run=(file,extra={})=>{const r=spawnSync(process.execPath,[file],{env:{...env,...extra},encoding:'utf8'});assert.equal(r.status,0,`${file} ${r.stderr}`);};run('backend/dist/bootstrap/migrate.js');
 const keys=()=>generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});const merchant=keys(),platform=keys();
 env.WX_PAY_PRIVATE_KEY_PATH=join(temp,'merchant.pem');env.WX_PAY_PLATFORM_PUBLIC_KEY_PATH=join(temp,'platform.pem');writeFileSync(env.WX_PAY_PRIVATE_KEY_PATH,merchant.privateKey);writeFileSync(env.WX_PAY_PLATFORM_PUBLIC_KEY_PATH,platform.publicKey);
 const port=await unusedPort(),base=`http://127.0.0.1:${port}`;env.PORT=String(port);env.PUBLIC_API_BASE_URL=base;env.CORS_ORIGINS='';env.WX_PAY_NOTIFY_URL=base+'/api/payments/v1/notify';
 const payment=createPaymentHandler({merchantPublicKey:merchant.publicKey,platformPrivateKey:platform.privateKey,appid:env.WX_APPID,mchid:env.WX_PAY_MCHID,apiV3Key:env.WX_PAY_APIV3_KEY,notifyUrl:env.WX_PAY_NOTIFY_URL});
 sim=await startSimulator({appEnv:'simulation',controlToken:'test-only-control',appid:env.WX_APPID,secret:env.WX_APP_SECRET,paymentHandler:payment});env.WX_API_BASE_URL=sim.baseUrl;env.WX_PAY_ENDPOINT_BASE=sim.baseUrl;
 run('backend/dist/bootstrap/create-admin.js',{ADMIN_INITIAL_USERNAME:'demo-super',ADMIN_INITIAL_PASSWORD:'TestOnly-2026!'});
 const launch=(file)=>{const child=spawn(process.execPath,[file],{env,stdio:['ignore','pipe','pipe']});child.logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{child.logs=(child.logs+b).slice(-12000);});children.push(child);return child;};
 const api=launch('backend/dist/bootstrap/main.js');await eventually(async()=>{if(api.exitCode!==null)throw Error('API启动失败 '+api.logs);return(await fetch(base+'/api/health/ready')).ok;});
 db=new pg.Pool({connectionString:url.href});
 const http=async(path,{token,method='GET',body,status=200}={})=>{const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const json=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(json)}`);return json.data??json;};
 const control=async(body)=>{const r=await fetch(sim.baseUrl+'/simulation/control',{method:'POST',headers:{Authorization:'Bearer test-only-control','Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 const superLogin=await http('/admin/v1/auth/login',{method:'POST',body:{username:'demo-super',password:'TestOnly-2026!'}});
 const login=async(user)=>{const{code}=await control({action:'login-code',user});return http('/mini/v1/auth/login',{method:'POST',body:{code}});};
 const address=async(token)=>http('/mini/v1/addresses',{token,method:'POST',status:201,body:{receiverName:'本地测试',phone:'13800000001',province:'广东省',city:'深圳市',district:'南山区',detail:'模拟地址1号'}});
 return{env,base,sim,payment,db,http,control,login,address,superToken:superLogin.token,launch,stop,startWorker:()=>launch('backend/dist/bootstrap/worker.js')};
}
function png(){const crc=buf=>{let c=0xffffffff;for(const b of buf){c^=b;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;};const chunk=(type,data)=>{const header=Buffer.alloc(4);header.writeUInt32BE(data.length);const b=Buffer.concat([Buffer.from(type),data]),tail=Buffer.alloc(4);tail.writeUInt32BE(crc(b));return Buffer.concat([header,b,tail]);};const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(300);ihdr.writeUInt32BE(300,4);ihdr[8]=8;ihdr[9]=2;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc(300*(300*3+1)))),chunk('IEND',Buffer.alloc(0))]);}
export async function product(stack,extra={}){
 const form=new FormData();form.append('file',new Blob([png()],{type:'image/png'}),'simulation.png');const r=await fetch(stack.base+'/api/admin/v1/media',{method:'POST',headers:{Authorization:`Bearer ${stack.superToken}`},body:form});assert.equal(r.status,201);const media=(await r.json()).data;
 const p=await stack.http('/admin/v1/products',{token:stack.superToken,method:'POST',status:201,body:{name:'本地模拟苹果',originalPriceFen:1001,wholeQuantity:'10',unit:'斤',allowedShareUnits:[30,20,15,12],mainImageId:media.id,initialStockWholeItems:10,...extra}});
 await stack.http(`/admin/v1/products/${p.id}/publish`,{token:stack.superToken,method:'POST'});return p;
}
export async function order(stack,user,p,units){return stack.http('/mini/v1/orders',{token:user.token,method:'POST',status:201,body:{productId:p.id,units,addressId:user.address.id,idempotencyKey:randomUUID()}});}
export async function pay(stack,user,orderId,{callback=true}={}){
 await stack.http(`/mini/v1/orders/${orderId}/pay`,{token:user.token,method:'POST',status:201});const outTradeNo=(await stack.db.query('SELECT out_trade_no FROM payments WHERE order_id=$1',[orderId])).rows[0].out_trade_no;
 await stack.control({action:'payment-state',outTradeNo,tradeState:'SUCCESS'});if(callback){const result=await stack.control({action:'notify-payment',outTradeNo,repeats:2});assert.ok(result.callbackStatuses.every(s=>[200,204].includes(s)));}return outTradeNo;
}
