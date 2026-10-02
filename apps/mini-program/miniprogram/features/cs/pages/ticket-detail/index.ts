import {ticketDetail,ticketFeedback,newClientMessageId,type TicketDetail} from '../../../../platform/cs-api';
const labels:Record<string,string>={create:'提交工单',accept:'已受理',reply:'处理回复',request_feedback:'请求反馈',resolve:'标记解决',close:'关闭工单',user_feedback:'用户反馈',request_refund:'申请退款',request_reshipment:'申请补发',approve_refund:'批准退款',reject_refund:'拒绝退款',approve_reshipment:'批准补发',reject_reshipment:'拒绝补发'};
const statuses:Record<string,string>={open:'待处理',processing:'处理中',waiting_feedback:'请反馈处理结果',resolved:'已解决，等待确认',closed:'已关闭'};
Page({pending:null as {key:string;satisfied:boolean;text:string}|null,data:{id:'',loading:true,busy:false,awaiting:false,error:'',ticket:null as TicketDetail['ticket']|null,statusText:'',requests:[] as Array<{id:string;label:string;text:string}>,actions:[] as Array<{label:string;text:string;time:string}>,text:''},
  onLoad(q:Record<string,string|undefined>){this.pending=null;this.setData({id:q.id??''});},onShow(){void this.load();},
  async load(){this.setData({loading:true,error:''});try{const r=await ticketDetail(this.data.id);this.setData({ticket:r.ticket,requests:(r.requests??[]).map(a=>({id:a.id,label:(a.kind==='refund'?'全额退款':'补发')+' · '+({pending:'等待审核',executed:'已批准执行',rejected:'已拒绝'} as Record<string,string>)[a.status],text:a.reason+(a.amountFen!==null?' · ¥'+(a.amountFen/100).toFixed(2):'')+(a.reviewReason?'；审核意见：'+a.reviewReason:'')+(a.resultId&&a.kind==='refund'?'；退款请求已创建，到账以渠道结果为准':'')})),statusText:statuses[r.ticket.status]??r.ticket.status,actions:r.actions.map(a=>({label:labels[a.action]??'处理记录',time:new Date(a.createdAt).toLocaleString(),text:a.action==='user_feedback'?`${a.detail.satisfied?'确认解决':'仍未解决'} ${a.detail.text??''}`:String(a.detail.text??a.detail.reply??a.detail.reason??(a.detail.refundId?'退款申请已记录，实际到账以渠道状态为准。':''))}))});}catch(e){this.setData({error:e instanceof Error?e.message:'加载失败'});}finally{this.setData({loading:false});}},
  onText(e:WechatMiniprogram.Input){this.setData({text:e.detail.value});},
  async feedback(e:WechatMiniprogram.TouchEvent){if(this.data.busy)return;this.pending??={key:newClientMessageId(),satisfied:e.currentTarget.dataset.satisfied===true,text:this.data.text};await this.retry();},
  async retry(){
    if(this.data.busy||!this.pending)return;
    const p=this.pending;this.setData({busy:true,error:'',awaiting:true});
    try{await ticketFeedback(this.data.id,p.satisfied,p.text,p.key);this.pending=null;this.setData({awaiting:false});await this.load();}
    catch(e){this.setData({error:e instanceof Error?e.message:'提交失败'});}
    finally{this.setData({busy:false});}
  },
  discard(){this.pending=null;this.setData({awaiting:false});}
});
