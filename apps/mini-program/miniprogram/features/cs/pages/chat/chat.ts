import {fetchMessages,getConversation,sendMessage,endConversation,newClientMessageId,uploadImage,downloadImage,cardOptions,readCard,acknowledge,type OutgoingMessage} from '../../../../platform/cs-api';
import {UserAuthExpiredError} from '../../../../platform/user-auth';
interface DisplayMessage {seq:number;self:boolean;kind:string;text:string;image:string;timeText:string}
Page({
  data:{loading:true,error:'',conversationId:'',status:'',hasAgent:false,messages:[] as DisplayMessage[],input:'',sending:false,scrollInto:'',pending:false,hasMore:false,cardKinds:['订单','商品','拼单','退款'],cardKindIndex:0,options:[] as Array<{id:string;label:string}>,optionIndex:0},
  timer:null as number|null,cursor:0,pulling:false,visible:false,outgoing:null as OutgoingMessage|null,
  onLoad(query:Record<string,string|undefined>){this.setData({conversationId:query.id??''});const stored=wx.getStorageSync(`cs-outbox:${this.data.conversationId}`) as OutgoingMessage|undefined;if(stored?.clientMessageId){this.outgoing=stored;this.setData({pending:true});}void this.bootstrap();},
  onShow(){this.visible=true;if(!this.data.loading){void this.pull(false);this.startPolling();}},
  onHide(){this.visible=false;this.stopPolling();},onUnload(){this.visible=false;this.stopPolling();},
  stopPolling(){if(this.timer!==null){clearInterval(this.timer);this.timer=null;}},
  startPolling(){if(this.timer!==null||!this.visible||!['queued','active'].includes(this.data.status))return;this.timer=setInterval(()=>void this.pull(false),2000);},
  report(cause:unknown){this.setData({error:cause instanceof Error?cause.message:'操作失败'});if(cause instanceof UserAuthExpiredError)wx.showToast({title:'请先重新登录',icon:'none'});},
  async bootstrap(){this.setData({loading:true,error:''});try{await this.pull(true);this.setData({loading:false});this.startPolling();await this.loadOptions();}catch(e){this.report(e);this.setData({loading:false});}},
  async pull(initial:boolean){
    if(this.pulling||!this.data.conversationId)return;this.pulling=true;
    try{
      const [page,conv]=await Promise.all([fetchMessages(this.data.conversationId,this.cursor),getConversation(this.data.conversationId)]);
      const fresh:DisplayMessage[]=[];
      for(const m of page.messages){
        let text=String(m.content.text??''),image='';
        if(m.kind==='image'){try{image=await downloadImage(String(m.content.mediaAssetId));}catch{text='图片下载失败';}}
        if(m.kind==='card'){try{const data=await readCard(String(m.content.cardKind),String(m.content.cardRefId));if(data.product){const p=data.product as {name:string;originalPriceFen:number};text=`商品：${p.name} · ${(p.originalPriceFen/100).toFixed(2)}元`;}else if(data.order){const o=data.order as {orderNo:string;totalAmountFen:number};text=`订单：${o.orderNo} · ${(o.totalAmountFen/100).toFixed(2)}元`;}else if(data.group){text=`拼单进度 ${(data.group as {paidUnits:number}).paidUnits}/60`;}else{const r=data.refund as {paidAmountFen:number;items:unknown[]};text=`退款记录 · 实付 ${(r.paidAmountFen/100).toFixed(2)}元 · ${r.items.length}笔退款`;}}catch{text='业务卡片当前不可访问';}}
        fresh.push({seq:m.seq,self:m.sender==='user',kind:m.kind,text,image,timeText:new Date(m.createdAt).toLocaleTimeString()});
      }
      if(!this.visible&&!initial)return;
      const messages=[...new Map([...this.data.messages,...fresh].map(m=>[m.seq,m])).values()].sort((a,b)=>a.seq-b.seq);
      this.cursor=page.nextSeq;this.setData({messages,scrollInto:fresh.length?`msg-${fresh[fresh.length-1]?.seq}`:this.data.scrollInto,status:conv.conversation.status,hasAgent:conv.conversation.hasAgent,error:'',hasMore:page.messages.length===50});
      if(page.messages.length)await acknowledge(this.data.conversationId,this.cursor);
      if(!['queued','active'].includes(conv.conversation.status))this.stopPolling();
    }catch(e){if(initial)throw e;this.report(e);}finally{this.pulling=false;}
  },
  async loadOptions(){const kind=['order','product','group','refund'][this.data.cardKindIndex]??'order';const r=await cardOptions(kind);this.setData({options:r.items,optionIndex:0});},
  onCardKind(e:WechatMiniprogram.PickerChange){this.setData({cardKindIndex:Number(e.detail.value)});void this.loadOptions().catch(e=>this.report(e));},
  onCardOption(e:WechatMiniprogram.PickerChange){this.setData({optionIndex:Number(e.detail.value)});},
  onInput(e:WechatMiniprogram.Input){this.setData({input:e.detail.value});},
  async transmit(message?:OutgoingMessage){if(this.data.sending||!['queued','active'].includes(this.data.status))return;
    if(!this.outgoing&&message)this.outgoing=message;if(!this.outgoing)return;
    wx.setStorageSync(`cs-outbox:${this.data.conversationId}`,this.outgoing);this.setData({sending:true,pending:true,error:''});
    try{await sendMessage(this.data.conversationId,this.outgoing);this.outgoing=null;wx.removeStorageSync(`cs-outbox:${this.data.conversationId}`);this.setData({input:'',pending:false});await this.pull(false);}catch(e){this.report(e);}finally{this.setData({sending:false});}
  },
  async send(){const text=this.data.input.trim();if(this.outgoing){await this.transmit();return;}if(text)await this.transmit({clientMessageId:newClientMessageId(),kind:'text',content:{text}});},
  discard(){this.outgoing=null;wx.removeStorageSync(`cs-outbox:${this.data.conversationId}`);this.setData({pending:false});},
  chooseImage(){if(this.data.sending||this.outgoing)return;wx.chooseMedia({count:1,mediaType:['image'],success:r=>{const path=r.tempFiles[0]?.tempFilePath;if(!path)return;void (async()=>{this.setData({sending:true});try{const a=await uploadImage(this.data.conversationId,path);this.setData({sending:false});await this.transmit({clientMessageId:newClientMessageId(),kind:'image',content:{mediaAssetId:a.id}});}catch(e){this.report(e);}finally{this.setData({sending:false});}})();}});},
  async sendCard(){if(this.outgoing)return;const o=this.data.options[this.data.optionIndex];if(!o)return;await this.transmit({clientMessageId:newClientMessageId(),kind:'card',content:{cardKind:['order','product','group','refund'][this.data.cardKindIndex],cardRefId:o.id}});},
  preview(e:WechatMiniprogram.TouchEvent){const path=e.currentTarget.dataset.path as string;if(path)wx.previewImage({current:path,urls:[path]});},
  loadMore(){void this.pull(false);},
  async endSession(){try{await endConversation(this.data.conversationId);this.setData({status:'ended'});this.stopPolling();}catch(e){this.report(e);}},
  retry(){void this.bootstrap();}
});
