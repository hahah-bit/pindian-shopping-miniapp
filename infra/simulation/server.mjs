import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function startSimulator(config) {
 if(config.appEnv!=='simulation'||!config.controlToken)throw Error('必须显式simulation且配置控制令牌');
 const users=['alice','bob','charlie'];const codes=new Map();const state={codes};
 const now=config.now??Date.now;
 const server=createServer(async(req,res)=>{
  const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  try {
   const url=new URL(req.url,'http://simulator');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536){reply(413,{error:'too_large'});return;}}
   const body=raw?JSON.parse(raw):{};
   if(url.pathname==='/health')return reply(200,{mode:'simulation'});
   if(url.pathname==='/simulation/control'){
    if(req.headers.authorization!==`Bearer ${config.controlToken}`)return reply(401,{error:'unauthorized'});
    if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
    if(['login-code','phone-code'].includes(body.action)){
     if(!users.includes(body.user)||!['success','invalid','down','expired','refused'].includes(body.scenario??'success'))return reply(400,{error:'invalid_control'});
     const code=randomUUID();codes.set(code,{kind:body.action,user:body.user,scenario:body.scenario??'success',expires:now()+300000});return reply(200,{code});
    }
    if(config.paymentHandler){const result=await config.paymentHandler({control:true,body,state,url,req});if(result)return reply(result.status,result.body);}
    return reply(400,{error:'unknown_action'});
   }
   if(url.pathname==='/sns/jscode2session'||url.pathname==='/wxa/business/getuserphonenumber'){
    const login=url.pathname==='/sns/jscode2session';const code=login?url.searchParams.get('js_code'):body.code;const c=codes.get(code);codes.delete(code);
    if(!c||c.kind!==(login?'login-code':'phone-code')||c.expires<=now()||['invalid','expired','refused'].includes(c.scenario))return reply(200,{errcode:40029,errmsg:'invalid simulation code'});
    if(c.scenario==='down')return reply(200,{errcode:-1,errmsg:'simulation unavailable'});
    if(login){if(url.searchParams.get('appid')!==config.appid||url.searchParams.get('secret')!==config.secret)return reply(200,{errcode:40013,errmsg:'invalid config'});return reply(200,{openid:`sim-${c.user}`,session_key:'simulation-only'});}
    if(url.searchParams.get('access_token')!=='simulation-access-token'||(body.openid&&body.openid!==`sim-${c.user}`))return reply(200,{errcode:40029,errmsg:'identity mismatch'});
    const number=`1380000000${users.indexOf(c.user)+1}`;
    return reply(200,{errcode:0,phone_info:{phoneNumber:number,purePhoneNumber:number,countryCode:'86',watermark:{timestamp:Math.floor(now()/1000),appid:config.appid}}});
   }
   if(url.pathname==='/cgi-bin/stable_token')return reply(200,body.appid===config.appid&&body.secret===config.secret?{access_token:'simulation-access-token',expires_in:7200}:{errcode:40013});
   if(config.paymentHandler){const result=await config.paymentHandler({control:false,body,raw,state,url,req});if(result)return reply(result.status,result.body);}
   reply(404,{error:'not_found'});
  }catch {if(!res.headersSent)reply(400,{error:'invalid_request'});else res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port??0,config.host??'127.0.0.1',resolve);});
 return {baseUrl:`http://127.0.0.1:${server.address().port}`,state,server,close:()=>new Promise(r=>{server.close(r);server.closeAllConnections();})};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const sim=await startSimulator({appEnv:process.env.APP_ENV,controlToken:process.env.SIMULATION_CONTROL_TOKEN,appid:process.env.WX_APPID,secret:process.env.WX_APP_SECRET,port:Number(process.env.PORT??3999),host:'0.0.0.0'});
 console.log('本地模拟服务已启动，仅使用虚拟凭据');for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await sim.close();process.exit(0);});
}
