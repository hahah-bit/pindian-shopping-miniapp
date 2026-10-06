import type {AiSupportTurnView} from '@pindian/contracts';
import {listAiMessages,sendAiMessage} from '../../api';
import {fetchCurrentUser,UserAuthExpiredError,ApiError} from '../../../../platform/user-auth';
import {newClientMessageId} from '../../../../platform/cs-api';
Page({
  data:{loading:true,error:'',messages:[] as AiSupportTurnView[],draft:'',sending:false,olderLoading:false,nextBefore:null as string|null,userId:'',scrollTarget:'',keyboardHeight:0,loggedIn:false},
  alive:true,
  onLoad(){this.alive=true;void this.load();},
  onUnload(){this.alive=false;},
  async load(){
    this.setData({loading:true,error:''});
    try {
      const user=await fetchCurrentUser();
      if(!this.alive)return;
      if(!user){this.setData({loggedIn:false,userId:'',messages:[],draft:'',loading:false});return;}
      if(this.data.userId!==user.id)this.setData({messages:[],draft:''});
      this.setData({loggedIn:true,userId:user.id});
      const result=await listAiMessages();
      if(!this.alive)return;
      this.setData({messages:result.items,nextBefore:result.nextBefore});this.scrollBottom();
    }catch(e){if(this.alive)this.handleError(e);}
    finally{if(this.alive)this.setData({loading:false});}
  },
  input(e:WechatMiniprogram.Input){this.setData({draft:e.detail.value});},
  keyboard(e:WechatMiniprogram.CustomEvent<{height:number}>){this.setData({keyboardHeight:e.detail.height??0});this.scrollBottom();},
  scrollBottom(){const last=this.data.messages[this.data.messages.length-1];if(last)this.setData({scrollTarget:'turn-'+last.clientMessageId});},
  handleError(e:unknown){
    if(e instanceof UserAuthExpiredError){this.setData({loggedIn:false,userId:'',messages:[],draft:'',error:'登录已过期，请重新登录'});return;}
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
    const owner=this.data.userId;
    const optimistic:AiSupportTurnView={id:'',clientMessageId,text,reply:null,status:'pending',createdAt:new Date().toISOString()};
    const existing=this.data.messages.find(x=>x.clientMessageId===clientMessageId);
    this.setData({sending:true,error:'',messages:existing?this.data.messages.map(x=>x.clientMessageId===clientMessageId?{...x,status:'pending'}:x):[...this.data.messages,optimistic]});this.scrollBottom();
    try{
      const result=await sendAiMessage(text,clientMessageId);
      if(this.alive&&this.data.userId===owner)this.setData({messages:this.data.messages.map(x=>x.clientMessageId===clientMessageId?result.turn:x)});
    }catch(e){if(this.alive&&this.data.userId===owner){this.setData({messages:this.data.messages.map(x=>x.clientMessageId===clientMessageId?{...x,status:e instanceof ApiError&&e.code==='AI_BUSY'?'pending':'failed'}:x)});this.handleError(e);}}
    finally{if(this.alive){this.setData({sending:false});this.scrollBottom();}}
  },
  async older(){if(!this.data.nextBefore||this.data.olderLoading)return;this.setData({olderLoading:true,error:''});try{const r=await listAiMessages(this.data.nextBefore);if(this.alive)this.setData({messages:[...r.items,...this.data.messages],nextBefore:r.nextBefore,scrollTarget:r.items[0]?'turn-'+r.items[0].clientMessageId:''});}catch(e){if(this.alive)this.handleError(e);}finally{if(this.alive)this.setData({olderLoading:false});}},
  refresh(){if(!this.data.sending)void this.load();},
  login(){wx.switchTab({url:'/features/profile/pages/index/index'});},
  human(){wx.navigateTo({url:'/features/cs/pages/index/index'});}
});
