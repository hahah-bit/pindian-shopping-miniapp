import{readFileSync}from'node:fs';import{resolve,dirname,sep}from'node:path';import{runInNewContext}from'node:vm';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
/** 加载实际小程序源码；只替换配置和wx平台，不替换业务API模块。 */
export function miniHarness(stack,{user='alice',payScenario='success'}={}){
 const root=resolve('apps/mini-program/miniprogram'),cache=new Map(),pending=new Set(),storage=new Map(),timers=new Set(),pages=[],events=[];const failures=new Set();
 const track=(work)=>{const p=Promise.resolve().then(work);pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};
 const wx={
  getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),
  request:o=>{track(async()=>{try{if([...failures].some(p=>o.url.includes(p)))throw Error('injected network failure');let url=new URL(o.url);const method=o.method??'GET';if(method==='GET'&&o.data)for(const[k,v]of Object.entries(o.data))if(v!==undefined)url.searchParams.set(k,String(v));const r=await fetch(url,{method,headers:o.header,body:method==='GET'||o.data===undefined?undefined:JSON.stringify(o.data),signal:AbortSignal.timeout(o.timeout??10000)});o.success?.({statusCode:r.status,data:await r.json()});}catch(e){o.fail?.({errMsg:e.message});}finally{o.complete?.();}});return{abort(){}};},
  login:o=>{track(async()=>{const{code}=await stack.control({action:'login-code',user});o.success?.({code});});},
  requestPayment:o=>{track(async()=>{if(payScenario==='cancel'||payScenario==='fail'){o.fail?.({errMsg:payScenario==='cancel'?'requestPayment:fail cancel':'requestPayment:fail'});return;}if(payScenario==='success'){const no=o.package.replace('prepay_id=sim-','');await stack.control({action:'payment-state',outTradeNo:no,tradeState:'SUCCESS'});}o.success?.({errMsg:'requestPayment:ok'});});},
  showToast:o=>events.push({kind:'toast',...o}),showModal:o=>{events.push({kind:'modal',...o});o.success?.({confirm:true});},
  navigateTo:o=>events.push({kind:'navigate',...o}),redirectTo:o=>events.push({kind:'redirect',...o}),navigateBack:()=>{},stopPullDownRefresh:()=>{},
  setNavigationBarTitle:o=>events.push({kind:'navigation-title',...o}),
 };
 const interval=(fn,ms)=>{const timer=setInterval(fn,ms);timers.add(timer);return timer;};
 function load(file){const path=resolve(file);if(!path.startsWith(root+sep))throw Error('模块越过小程序范围');if(path===resolve(root,'platform/config.ts'))return{apiConfig:{mode:'api',baseUrl:stack.base}};if(cache.has(path))return cache.get(path).exports;const module={exports:{}};cache.set(path,module);let definition;
  runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>{if(!name.startsWith('.'))throw Error('测试不允许外部运行模块 '+name);return load(resolve(dirname(path),name+'.ts'));},wx,Page:d=>definition=d,console,Error,Date,Promise,Math,JSON,setTimeout,clearTimeout,setInterval:interval,clearInterval:t=>{clearInterval(t);timers.delete(t);}}, {filename:path});
  if(definition)module.exports.__page=definition;return module.exports;
 }
 return{storage,events,failures,wx,
  module:path=>load(resolve(root,path)),
  page:path=>{const d=load(resolve(root,path)).__page;if(!d)throw Error('未注册Page');const page=Object.assign(Object.create(d),{data:structuredClone(d.data),setData(value){for(const[k,v]of Object.entries(value)){if(k.includes('.'))throw Error('装置尚不支持嵌套setData '+k);this.data[k]=v;}}});pages.push(page);return page;},
  async idle(){for(let i=0;i<50;i++){if(pending.size)await Promise.all([...pending]);await new Promise(r=>setTimeout(r,0));if(!pending.size)return;}throw Error('页面请求未收敛');},
  close(){for(const p of pages)p.onUnload?.();for(const t of timers)clearInterval(t);}
 };
}
