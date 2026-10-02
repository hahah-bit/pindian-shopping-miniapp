import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{parseEnv}from'node:util';import pg from'pg';import{product,order,pay,eventually}from'../../tests/helpers/local-stack.mjs';
const env=parseEnv(readFileSync('.env.simulation','utf8'));if(env.APP_ENV!=='simulation'||env.POSTGRES_DB!=='pindian_simulation')throw Error('仅限独立模拟环境');
const db=new pg.Pool({connectionString:`postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`});
const s={base:'http://127.0.0.1:3300',db};
s.http=async(path,{token,method='GET',body,status=200}={})=>{const r=await fetch(s.base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const j=await r.json();assert.equal(r.status,status,JSON.stringify(j));return j.data??j;};
s.control=async(body)=>{const r=await fetch('http://127.0.0.1:3399/simulation/control',{method:'POST',headers:{Authorization:'Bearer '+env.SIMULATION_CONTROL_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
try{
s.superToken=(await s.http('/admin/v1/auth/login',{method:'POST',body:{username:'demo-super',password:'TestOnly-2026!'}})).token;
const users=[];for(const name of ['alice','bob']){const {code}=await s.control({action:'login-code',user:name});const u=await s.http('/mini/v1/auth/login',{method:'POST',body:{code}});const addresses=await s.http('/mini/v1/addresses',{token:u.token});u.address=addresses.items?.[0]??await s.http('/mini/v1/addresses',{token:u.token,method:'POST',status:201,body:{receiverName:'本地测试',phone:'13800000001',province:'广东省',city:'深圳市',district:'南山区',detail:'隔离演练地址'}});users.push(u);}
const p=await product(s,{originalPriceFen:1000,allowedShareUnits:[30]});const a=await order(s,users[0],p,30),b=await order(s,users[1],p,30);await pay(s,users[1],b.id);await pay(s,users[0],a.id);
await eventually(async()=>Number((await db.query('SELECT count(*) c FROM fulfillment_orders WHERE group_id=$1',[a.groupId])).rows[0].c)===2);
const overview=await s.http('/admin/v1/reporting/overview',{token:s.superToken});assert.ok(overview.overview.successGroups>=1);await eventually(async()=>(await s.http('/mini/v1/notifications',{token:users[0].token})).items.some(x=>x.eventType==='group.succeeded'));
console.log('Docker整体业务冒烟通过：真实HTTP商品/混合支付顺序/Worker分份履约/通知/看板');
}finally{await db.end();}
