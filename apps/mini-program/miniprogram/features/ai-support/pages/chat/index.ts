import type {AiSupportTurnView} from '@pindian/contracts';
import {listAiMessages,sendAiMessage} from '../../api';
import {fetchCurrentUser,UserAuthExpiredError,ApiError} from '../../../../platform/user-auth';
import {newClientMessageId} from '../../../../platform/cs-api';
Page({
  data:{loading:true,error:'',messages:[] as AiSupportTurnView[],draft:'',sending:false,olderLoading:false,nextBefore:null as string|null,userId:'',scrollTarget:'',keyboardHeight:0,loggedIn:false,visible:false,reducedMotion:false},
  alive:true,loadVersion:0,sendVersion:0,olderVersion:0,
  onLoad(){this.alive=true;},
  async onShow(){this.setData({visible:true});await this.load();},
  onHide(){this.setData({visible:false,keyboardHeight:0});},
  onUnload(){this.alive=false;this.loadVersion++;this.sendVersion++;this.olderVersion++;},
  changeOwner(userId:string){
    if(this.data.userId!==userId){this.sendVersion++;this.olderVersion++;this.setData({userId,messages:[],draft:'',sending:false,nextBefore:null,olderLoading:false});}
    this.setData({loggedIn:Boolean(userId)});
  },
  async load(){
    const version=++this.loadVersion;this.olderVersion++;
    this.setData({loading:true,error:'',olderLoading:false});
    try {
      const user=await fetchCurrentUser();
      if(!this.alive||version!==this.loadVersion)return;
      this.changeOwner(user?.id??'');
      if(!user||this.data.sending)return;
      const owner=user.id;
      const result=await listAiMessages();
      if(!this.alive||version!==this.loadVersion||this.data.userId!==owner)return;
      const keys=new Set(result.items.map(x=>x.clientMessageId));
      const unsaved=this.data.messages.filter(x=>!x.id&&!keys.has(x.clientMessageId));
      this.setData({messages:[...result.items,...unsaved],nextBefore:result.nextBefore});this.scrollBottom();
    }catch(e){if(this.alive&&version===this.loadVersion){this.setData({loggedIn:false});this.handleError(e);}}
    finally{if(this.alive&&version===this.loadVersion)this.setData({loading:false});}
  },
  input(e:WechatMiniprogram.CustomEvent<{value:string}>){this.setData({draft:e.detail.value});},
  toggleMotion(){this.setData({reducedMotion:!this.data.reducedMotion});},
  keyboard(e:WechatMiniprogram.CustomEvent<{height:number}>){this.setData({keyboardHeight:e.detail.height??0});this.scrollBottom();},
  scrollBottom(){const last=this.data.messages[this.data.messages.length-1];if(last)this.setData({scrollTarget:'turn-'+last.clientMessageId});},
  handleError(e:unknown){
    if(e instanceof UserAuthExpiredError){this.changeOwner('');this.setData({error:'登录已过期，请重新登录'});return;}
    this.setData({error:e instanceof Error?e.message:'暂时无法回复，请重试'});
  },
  async send(){
    const text=this.data.draft.trim();if(!text||this.data.sending||!this.data.loggedIn)return;
    const clientMessageId=newClientMessageId();
    this.setData({draft:''});await this.submit(text,clientMessageId);
  },
  quick(e:WechatMiniprogram.TouchEvent){if(this.data.sending)return;this.setData({draft:e.currentTarget.dataset.text});void this.send();},
  retryTurn(e:WechatMiniprogram.TouchEvent){const turn=this.data.messages.find(x=>x.clientMessageId===e.currentTarget.dataset.id);if(turn&&!this.data.sending)void this.submit(turn.text,turn.clientMessageId);},
  async submit(text:string,clientMessageId:string){
    if(this.data.sending||!this.data.loggedIn)return;
    const owner=this.data.userId,version=++this.sendVersion;
    const current=()=>this.alive&&this.data.userId===owner&&version===this.sendVersion;
    const optimistic:AiSupportTurnView={id:'',clientMessageId,text,reply:null,status:'pending',createdAt:new Date().toISOString()};
    const existing=this.data.messages.find(x=>x.clientMessageId===clientMessageId);
    this.setData({sending:true,error:'',messages:existing?this.data.messages.map(x=>x.clientMessageId===clientMessageId?{...x,status:'pending'}:x):[...this.data.messages,optimistic]});this.scrollBottom();
    try{
      const result=await sendAiMessage(text,clientMessageId);
      if(current())this.setData({messages:this.data.messages.map(x=>x.clientMessageId===clientMessageId?result.turn:x)});
    }catch(e){if(current()){this.setData({messages:this.data.messages.map(x=>x.clientMessageId===clientMessageId?{...x,status:e instanceof ApiError&&e.code==='AI_BUSY'?'pending':'failed'}:x)});this.handleError(e);}}
    finally{if(current()){this.setData({sending:false});this.scrollBottom();}}
  },
  async older(){
    if(!this.data.nextBefore||this.data.olderLoading||!this.data.loggedIn)return;
    const owner=this.data.userId,version=++this.olderVersion;
    const current=()=>this.alive&&this.data.userId===owner&&version===this.olderVersion;
    this.setData({olderLoading:true,error:''});
    try{const r=await listAiMessages(this.data.nextBefore);if(current())this.setData({messages:[...r.items,...this.data.messages],nextBefore:r.nextBefore,scrollTarget:r.items[0]?'turn-'+r.items[0].clientMessageId:''});}
    catch(e){if(current())this.handleError(e);}finally{if(current())this.setData({olderLoading:false});}
  },
  refresh(){if(!this.data.sending)void this.load();},
  login(){wx.switchTab({url:'/features/profile/pages/index/index'});},
  human(){wx.navigateTo({url:'/features/cs/pages/index/index'});}
});
