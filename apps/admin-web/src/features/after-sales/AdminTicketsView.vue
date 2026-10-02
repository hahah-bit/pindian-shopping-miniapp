<script setup lang="ts">
import {onMounted,ref} from 'vue';
import type {AdminProfile} from '@pindian/contracts';
import {request} from '../../platform/api-client';
import {post} from '../admin-cs/api';
const props=defineProps<{principal:AdminProfile|null}>();
interface Ticket {ticketId:string;title:string;description:string;status:string;type:string;relatedOrderId:string|null;relatedRefundId:string|null}
interface Action {action:string;actorType:string;detail:Record<string,unknown>;createdAt:string}
interface Approval {id:string;ticketId:string;kind:string;status:string;reason:string;amountFen:number|null;reviewReason:string|null;resultId:string|null;payload:Record<string,unknown>}
interface Fulfillment {id:string;unit:string;allocatedQuantityGrams:number;shippedQuantityGrams:number;refundHeld:boolean}
const approvals=ref<Approval[]>([]),fulfillment=ref<Fulfillment|null>(null),ship=ref({quantity:'',company:'',trackingNo:''}),reviewReasons=ref<Record<string,string>>({});
const items=ref<Array<{id:string;title:string;type:string;status:string}>>([]),ticket=ref<Ticket|null>(null),actions=ref<Action[]>([]);
const page=ref(1),total=ref(0),filter=ref(''),busy=ref(false),loading=ref(false),error=ref(''),notice=ref(''),text=ref('');
const pending=ref<{id:string;name:string;body:Record<string,unknown>;url?:string}|null>(null);
const base='/api/admin/v1/after-sales/tickets';
const statuses:Record<string,string>={open:'待处理',processing:'处理中',waiting_feedback:'等待用户反馈',resolved:'已解决',closed:'已关闭'};
const types:Record<string,string>={group_issue:'拼单问题',payment_issue:'支付问题',refund_issue:'退款问题',product_issue:'商品问题',shipment_issue:'发货问题',complaint:'投诉建议',other:'其他问题'};
const labels:Record<string,string>={create:'提交',accept:'受理',reply:'回复',request_feedback:'请求反馈',request_refund:'申请退款',request_reshipment:'申请补发',approve_refund:'批准退款',reject_refund:'拒绝退款',approve_reshipment:'批准补发',reject_reshipment:'拒绝补发',resolve:'解决',close:'关闭',user_feedback:'用户反馈'};
async function perform(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';try{await fn();}catch(e){error.value=e instanceof Error?e.message:'操作失败';}finally{busy.value=false;}}
async function load(){loading.value=true;try{const r=await request<{items:typeof items.value;total:number}>(`${base}?page=${page.value}&pageSize=10${filter.value?`&status=${filter.value}`:''}`);items.value=r.items;total.value=r.total;}finally{loading.value=false;}}
async function select(id:string){const r=await request<{ticket:Ticket;actions:Action[]}>(`${base}/${id}`);const [a,f]=await Promise.all([request<{items:Approval[]}>(`${base}/${id}/requests`),request<{fulfillment:Fulfillment|null}>(`${base}/${id}/fulfillment`)]);ticket.value=r.ticket;actions.value=r.actions;approvals.value=a.items;fulfillment.value=f.fulfillment;text.value='';ship.value={quantity:'',company:'',trackingNo:''};}
async function action(name:string){
  if(!pending.value){if(!ticket.value)return;const body=name==='refund'?{orderId:ticket.value.relatedOrderId}:name==='resolve'?{reply:text.value}:name==='close'?{reason:text.value}:{text:text.value};pending.value={id:ticket.value.ticketId,name,body:{...body,clientActionId:crypto.randomUUID()}};}
  const p=pending.value;await post(p.url??`${base}/${p.id}/${p.name}`,p.body);pending.value=null;notice.value='操作已保存，退款到账以渠道结果为准';await select(p.id);await load();
}
async function apply(kind:'refund'|'reshipment'){
  if(!ticket.value||pending.value)return;
  const quantity=Number(ship.value.quantity);
  if(kind==='reshipment'&&(!fulfillment.value||!Number.isInteger(quantity)||quantity<=0||quantity>2147483647))throw new Error('补发数量必须为有效正整数');
  pending.value={id:ticket.value.ticketId,name:kind,body:{orderId:ticket.value.relatedOrderId,reason:text.value,clientRequestId:crypto.randomUUID(),...(kind==='reshipment'?{fulfillmentId:fulfillment.value!.id,quantityGrams:quantity,company:ship.value.company,trackingNo:ship.value.trackingNo}:{})}};await action(kind);
}
async function review(a:Approval,decision:'approve'|'reject'){
  if(pending.value)return;pending.value={id:a.ticketId,name:'review',url:`/api/admin/v1/after-sales/requests/${a.id}/review`,body:{decision,reason:reviewReasons.value[a.id]}};await action('review');
}
function unit(f:Fulfillment){return ['斤','千克','kg','克','g','两'].includes(f.unit)?'克':f.unit;}
const approvalStatuses:Record<string,string>={pending:'等待超级管理员审核',executed:'已批准并创建执行记录',rejected:'已拒绝'};
function detail(a:Action){if(a.action==='user_feedback')return `${a.detail.satisfied?'确认解决':'仍未解决'} ${a.detail.text??''}`;return String(a.detail.text??a.detail.reply??a.detail.reason??(a.detail.refundId?'退款申请已记录':''));}
onMounted(()=>void perform(async()=>{await load();const id=new URLSearchParams(location.hash.split('?')[1]??'').get('ticketId');if(id)await select(id);}));
</script>
<template>
  <div class="toolbar"><div><h2>售后工单</h2><p>客服申请退款或补发，超级管理员审核后执行</p></div><select v-model="filter" @change="page=1;perform(load)"><option value="">全部状态</option><option v-for="(label,key) in statuses" :key="key" :value="key">{{label}}</option></select><button :disabled="busy" @click="perform(load)">刷新</button></div>
  <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p><p v-if="loading">正在读取工单…</p>
  <p v-if="pending" role="status">上次操作尚未确认。<button :disabled="busy" @click="perform(()=>action(pending!.name))">重试原操作</button><button :disabled="busy" @click="pending=null">放弃重试</button></p>
  <table v-if="items.length" class="data-table"><thead><tr><th>标题</th><th>类型</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="t in items" :key="t.id"><td>{{t.title}}</td><td>{{types[t.type]}}</td><td>{{statuses[t.status]}}</td><td><button v-if="t.status==='open'" :disabled="busy" @click="perform(async()=>{await post(`${base}/${t.id}/accept`);await select(t.id);await load()})">受理</button><button :disabled="busy" @click="perform(()=>select(t.id))">详情</button></td></tr></tbody></table><p v-else-if="!loading&&!error">暂无工单</p>
  <div class="controls"><button :disabled="page<=1||busy" @click="page--;perform(load)">上一页</button><span>{{page}} / {{Math.max(1,Math.ceil(total/10))}}</span><button :disabled="page*10>=total||busy" @click="page++;perform(load)">下一页</button></div>
  <section v-if="ticket" class="ticket-detail"><h3>{{ticket.title}} · {{statuses[ticket.status]}}</h3><p>{{ticket.description}}</p><p v-if="ticket.relatedOrderId">已关联交易订单</p><p v-if="ticket.relatedRefundId">退款申请已记录，实际到账以渠道结果为准。</p>
    <ol><li v-for="(a,i) in actions" :key="i"><small>{{new Date(a.createdAt).toLocaleString()}} · {{labels[a.action]??a.action}}</small><p>{{detail(a)}}</p></li></ol>
    <fieldset v-if="ticket.status!=='closed'" :disabled="busy||!!pending" class="actions"><textarea v-model="text" maxlength="2000" placeholder="回复内容或处理原因"/><button v-if="['processing','waiting_feedback'].includes(ticket.status)" :disabled="busy||!text.trim()" @click="perform(()=>action('reply'))">回复用户</button><button v-if="ticket.status==='processing'" :disabled="busy||!text.trim()" @click="perform(()=>action('request-feedback'))">请求用户反馈</button><button v-if="ticket.status==='processing'" :disabled="busy||!text.trim()" @click="perform(()=>action('resolve'))">标记解决</button><button :disabled="busy||!text.trim()" @click="perform(()=>action('close'))">关闭工单</button><template v-if="['processing','waiting_feedback'].includes(ticket.status)&&ticket.relatedOrderId"><button :disabled="!text.trim()||!!ticket.relatedRefundId||approvals.some(a=>a.kind==='refund'&&a.status==='pending')" @click="perform(()=>apply('refund'))">申请全额退款</button><div v-if="fulfillment&&!fulfillment.refundHeld"><p>补发 · 原分配 {{fulfillment.allocatedQuantityGrams}} {{unit(fulfillment)}}，正常已发 {{fulfillment.shippedQuantityGrams}} {{unit(fulfillment)}}</p><input v-model="ship.quantity" type="number" min="1" step="1" aria-label="补发数量" placeholder="补发数量"/><input v-model="ship.company" maxlength="30" aria-label="快递公司" placeholder="快递公司"/><input v-model="ship.trackingNo" maxlength="64" aria-label="补发运单号" placeholder="补发运单号"/><button :disabled="!text.trim()||!ship.quantity||!ship.company.trim()||!ship.trackingNo.trim()" @click="perform(()=>apply('reshipment'))">申请补发</button></div><p v-if="fulfillment?.refundHeld">已批准全额退款，停止新增发货和补发。</p></template></fieldset>
    <h4 v-if="approvals.length">退款与补发申请</h4><article v-for="a in approvals" :key="a.id" class="approval"><strong>{{a.kind==='refund'?'全额退款':'补发'}} · {{approvalStatuses[a.status]}}</strong><p>{{a.reason}} <span v-if="a.amountFen!==null">· ¥{{(a.amountFen/100).toFixed(2)}}（含服务费）</span></p><p v-if="a.kind==='reshipment'">补发数量 {{a.payload.quantityGrams}} · {{a.payload.company}} {{a.payload.trackingNo}}</p><p v-if="a.reviewReason">审核意见：{{a.reviewReason}}</p><p v-if="a.resultId">{{a.kind==='refund'?'退款请求已创建，到账以渠道结果为准':'补发包裹已创建'}} · {{a.resultId}}</p><fieldset v-if="a.status==='pending'&&props.principal?.role==='super_admin'" :disabled="busy||!!pending"><input v-model="reviewReasons[a.id]" maxlength="1000" aria-label="审核意见" placeholder="审核意见必填"/><button :disabled="!reviewReasons[a.id]?.trim()" @click="perform(()=>review(a,'approve'))">批准并执行</button><button :disabled="!reviewReasons[a.id]?.trim()" @click="perform(()=>review(a,'reject'))">拒绝申请</button></fieldset></article>
  </section>
</template>
<style scoped>.ticket-detail{margin-top:24px;background:#fff;padding:24px;border-radius:12px}.ticket-detail>p,.ticket-detail li p{white-space:pre-wrap}.ticket-detail li{padding:8px 0}.ticket-detail textarea{width:100%;min-height:100px}.actions{display:flex;gap:10px;flex-wrap:wrap}.controls{display:flex;gap:12px;margin-top:16px}.approval{border-top:1px solid #ddd;padding:16px 0}.approval input{margin:6px}fieldset{border:0;padding:0}</style>
