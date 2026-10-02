<script setup lang="ts">
import {computed,onMounted,onBeforeUnmount,ref} from 'vue';
import type {AdminProfile} from '@pindian/contracts';
import {request} from '../../platform/api-client';
import {cs,post,imageUrl,cardText,type Conversation,type Message} from './api';
const props=defineProps<{principal:AdminProfile|null}>();
const accounts=ref<Array<{id:string;username:string;displayName:string;role:string;status:string}>>([]),accountForm=ref({username:'',displayName:'',password:'',role:'cs_agent'});
const orderOptions=ref<Array<{id:string;label:string}>>([]),ticketOrder=ref('');
const items=ref<Conversation[]>([]),selected=ref<Conversation|null>(null),messages=ref<Array<Message&{display:string;image?:string}>>([]);
const mode=ref('active'),error=ref(''),notice=ref(''),loading=ref(false),busy=ref(false),text=ref(''),note=ref(false);
const page=ref(1),total=ref(0);
const agents=ref<Array<{id:string;displayName:string;activeCount:number}>>([]),target=ref('');
const title=ref(''),description=ref(''),type=ref('other');
const cardKind=ref('order'),cardOptions=ref<Array<{id:string;label:string}>>([]),cardRef=ref('');
const writable=computed(()=>selected.value?.status==='active');
let timer:number|undefined,cursor=0,refreshing=false,generation=0;
let pulling:Promise<void>|null=null;
const pending=ref<{key:string;kind:string;content:Record<string,unknown>;internal:boolean}|null>(null);
const urls:string[]=[];
const statusText:Record<string,string>={queued:'排队中',active:'接待中',ended:'已结束',converted:'已转工单'};
function fail(e:unknown){error.value=e instanceof Error?e.message:'操作失败';}
async function perform(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';notice.value='';try{await fn();}catch(e){fail(e);}finally{busy.value=false;}}
async function load(){
  const path=mode.value==='queued'?cs('queue'):cs(`conversations?status=${mode.value}&page=${page.value}&pageSize=20`);
  const r=await request<{items:Conversation[];total?:number}>(path);items.value=r.items;total.value=r.total??r.items.length;
  agents.value=(await request<{items:Array<{id:string;displayName:string;activeCount:number}>}>(cs('agents'))).items;
}
async function pull(){
  const previous=pulling;
  const job=(async()=>{if(previous)await previous;await readMessages();})();pulling=job;
  try{await job;}finally{if(pulling===job)pulling=null;}
}
async function readMessages(){
  const current=selected.value;if(!current)return;const stamp=generation;
  const result=await request<{messages:Message[];nextSeq:number}>(cs(`conversations/${current.id}/messages?afterSeq=${cursor}`));
  const fresh=[] as Array<Message&{display:string;image?:string}>;
  for(const m of result.messages){
    let display=String(m.content.text??''),image:string|undefined;
    if(m.kind==='image'){try{image=await imageUrl(String(m.content.mediaAssetId));urls.push(image);}catch{display='图片暂不可读';}}
    if(m.kind==='card'){try{display=cardText(await request<Record<string,unknown>>(cs(`conversations/${current.id}/cards/${m.content.cardKind}/${m.content.cardRefId}`)));}catch{display='业务卡片当前不可访问';}}
    fresh.push({...m,display,image});
  }
  if(stamp!==generation)return;
  messages.value=[...new Map([...messages.value,...fresh].map(m=>[m.seq,m])).values()].sort((a,b)=>a.seq-b.seq);cursor=result.nextSeq;
  const updated=(await request<{conversation:Conversation}>(cs(`conversations/${current.id}`))).conversation;
  if(stamp===generation)selected.value=updated;
}
async function refresh(){if(refreshing)return;refreshing=true;try{await post(cs('heartbeat'));await load();await pull();}catch(e){fail(e);}finally{refreshing=false;loading.value=false;}}
async function open(c:Conversation){generation++;cursor=0;messages.value=[];pending.value=null;selected.value=c;ticketOrder.value='';await pull();await options();orderOptions.value=(await request<{items:Array<{id:string;label:string}>}>(cs(`conversations/${c.id}/card-options/order`))).items;}
async function options(){cardRef.value='';cardOptions.value=[];if(!selected.value)return;cardOptions.value=(await request<{items:Array<{id:string;label:string}>}>(cs(`conversations/${selected.value.id}/card-options/${cardKind.value}`))).items;}
async function send(kind='text',content:Record<string,unknown>={text:text.value},internal=note.value){
  if(!selected.value||!writable.value)return;
  if(!pending.value)pending.value={key:crypto.randomUUID(),kind,content,internal};
  const p=pending.value;
  await post(cs(`conversations/${selected.value.id}/messages`),{clientMessageId:p.key,kind:p.kind,content:p.content,internal:p.internal});pending.value=null;text.value='';notice.value='已发送';await pull();
}
async function upload(event:Event){const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file||!selected.value)return;await perform(async()=>{const form=new FormData();form.append('file',file);const a=await request<{id:string}>(cs(`conversations/${selected.value!.id}/images`),{method:'POST',body:form});await send('image',{mediaAssetId:a.id},false);});input.value='';}
async function loadAccounts(){accounts.value=(await request<{items:typeof accounts.value}>(cs('accounts'))).items;}
async function createAccount(){await post(cs('accounts'),accountForm.value);accountForm.value.password='';notice.value='客服账号已创建';await loadAccounts();}
onMounted(()=>{loading.value=true;void refresh();timer=window.setInterval(()=>void refresh(),5000);});
onBeforeUnmount(()=>{generation++;clearInterval(timer);urls.forEach(URL.revokeObjectURL);});
</script>
<template>
  <div class="toolbar"><div><h2>客服工作台</h2><p>在线接待、离线留言与历史会话</p></div><select v-model="mode" @change="page=1;perform(load)"><option value="active">我的接待</option><option value="queued">排队留言</option><option value="ended">结束历史</option><option value="converted">已转工单</option></select><button @click="refresh">刷新</button></div>
  <p v-if="error" class="error" role="alert">{{error}} <button @click="refresh">重试</button></p><p v-if="notice" role="status">{{notice}}</p><p v-if="loading">正在加载…</p>
  <details v-if="props.principal?.role==='super_admin'" class="account-settings"><summary @click="perform(loadAccounts)">客服账号管理</summary><form @submit.prevent="perform(createAccount)"><input v-model="accountForm.username" placeholder="登录名（小写字母/数字）" required/><input v-model="accountForm.displayName" placeholder="展示名" required/><input v-model="accountForm.password" type="password" autocomplete="new-password" placeholder="初始密码（10–128位）" minlength="10" maxlength="128" required/><select v-model="accountForm.role"><option value="cs_agent">客服</option><option value="cs_supervisor">客服主管</option></select><button :disabled="busy">创建账号</button></form><p v-for="a in accounts" :key="a.id">{{a.displayName}} · {{a.username}} · {{a.role==='cs_agent'?'客服':'主管'}} · {{a.status==='active'?'启用':'停用'}} <button :disabled="busy" @click="perform(async()=>{await post(cs(`accounts/${a.id}/status`),{status:a.status==='active'?'disabled':'active'});await loadAccounts()})">{{a.status==='active'?'停用':'启用'}}</button></p></details>
  <div class="cs-workspace">
    <section class="conversation-list"><p v-if="!items.length&&!loading">暂无会话</p><article v-for="c in items" :key="c.id"><strong>{{statusText[c.status]}}</strong><small>{{c.id.slice(0,8)}}</small><button v-if="c.status==='queued'" :disabled="busy" @click="perform(async()=>{const r=await post<{conversation:Conversation}>(cs(`conversations/${c.id}/accept`));await open(r.conversation);await load()})">接入</button><button v-else :disabled="busy" @click="perform(()=>open(c))">查看会话</button></article><div v-if="mode!=='queued'" class="controls"><button :disabled="page<=1||busy" @click="page--;perform(load)">上一页</button><span>第{{page}}页</span><button :disabled="page*20>=total||busy" @click="page++;perform(load)">下一页</button></div></section>
    <section v-if="selected" class="chat-panel"><h3>会话 · {{statusText[selected.status]}}</h3><div class="chat-history"><p v-if="!messages.length">暂无消息</p><article v-for="m in messages" :key="m.seq" :class="{internal:m.internal}"><small>{{m.internal?'内部备注':m.sender==='user'?'用户':'客服'}} · {{new Date(m.createdAt).toLocaleString()}}</small><img v-if="m.image" :src="m.image" alt="聊天图片"/><p v-else>{{m.display}}</p></article></div><button @click="perform(pull)">继续加载消息</button>
      <div v-if="writable" class="cs-composer"><textarea v-model="text" maxlength="2000" placeholder="输入回复" :disabled="busy||!!pending"/><label><input v-model="note" type="checkbox" :disabled="!!pending"/>内部备注（用户不可见）</label><button :disabled="busy||(!text.trim()&&!pending)" @click="perform(()=>send())">{{pending?'重试未确认消息':'发送'}}</button><button v-if="pending" :disabled="busy" @click="pending=null">取消重试</button><label>发送图片<input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy||!!pending" @change="upload"/></label>
      <div class="controls"><select v-model="cardKind" @change="perform(options)"><option value="order">订单卡片</option><option value="product">商品卡片</option><option value="group">拼单卡片</option><option value="refund">退款卡片</option></select><select v-model="cardRef"><option value="">选择相关业务（最近50条）</option><option v-for="o in cardOptions" :key="o.id" :value="o.id">{{o.label}}</option></select><button :disabled="busy||!cardRef||!!pending" @click="perform(()=>send('card',{cardKind,cardRefId:cardRef},false))">发送卡片</button></div>
      <div class="controls"><select v-model="target"><option value="">选择在线客服</option><option v-for="a in agents" :key="a.id" :value="a.id">{{a.displayName}}（接待{{a.activeCount}}）</option></select><button :disabled="busy||!target" @click="perform(async()=>{await post(cs(`conversations/${selected!.id}/transfer`),{targetAgentId:target});selected=null;await load()})">转接</button><button :disabled="busy" @click="perform(async()=>{await post(cs(`conversations/${selected!.id}/end`));await pull();await load()})">结束会话</button></div>
      <details><summary>转售后工单</summary><select v-model="type"><option value="other">其他问题</option><option value="shipment_issue">发货问题</option><option value="refund_issue">退款问题</option><option value="product_issue">商品问题</option><option value="complaint">投诉建议</option><option value="payment_issue">支付问题</option><option value="group_issue">拼单问题</option></select><select v-model="ticketOrder"><option value="">不关联订单</option><option v-for="o in orderOptions" :key="o.id" :value="o.id">{{o.label}}</option></select><input v-model="title" maxlength="60" placeholder="工单标题"/><textarea v-model="description" maxlength="2000" placeholder="问题描述"/><button :disabled="busy||!title.trim()||!description.trim()" @click="perform(async()=>{await post(cs(`conversations/${selected!.id}/convert-ticket`),{type,title,description,...(ticketOrder?{orderId:ticketOrder}:{})});notice='已转为工单';await pull();await load()})">创建工单</button></details>
      </div><p v-else>会话历史只读，可在售后工单继续处理。</p>
    </section><section v-else class="placeholder">选择会话开始接待</section>
  </div>
</template>
<style scoped>
.cs-workspace{display:grid;grid-template-columns:260px minmax(0,1fr);gap:20px}.conversation-list article{padding:14px;border-bottom:1px solid #ddd;display:flex;gap:10px;flex-wrap:wrap}.chat-panel{background:white;padding:20px;border-radius:12px}.chat-history{height:420px;overflow:auto}.chat-history article{padding:12px;border-bottom:1px solid #eee}.chat-history .internal{background:#fff3d7}.chat-history img{max-width:280px;max-height:220px;display:block}.chat-history p{white-space:pre-wrap}.cs-composer{display:grid;gap:14px}.cs-composer textarea{width:100%;min-height:90px}.controls{display:flex;gap:8px;flex-wrap:wrap}details input,details textarea{display:block;margin:10px 0;width:100%}small{color:#667}
</style>
