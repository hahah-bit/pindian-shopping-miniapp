import {ApplicationError} from '../../../../shared/kernel';
import type {AiSupportRepository,AiReplyPort} from './ports';
import {aiMessageInput,isUuid,maskAiText} from '../../domain/ai-support';
export class AiSupportService {
  constructor(readonly deps:{repository:AiSupportRepository;model:AiReplyPort;now?:()=>Date;timeoutMs?:number}) {}
  private now(){return this.deps.now?.()??new Date();}
  async list(userId:string,query:{before?:unknown;pageSize?:unknown}) {
    if(!userId)throw new ApplicationError('UNAUTHENTICATED','请先登录后咨询');
    const before=typeof query.before==='string'&&query.before?query.before:undefined;
    if(before&&!isUuid(before))throw new ApplicationError('VALIDATION_FAILED','消息游标无效');
    const limit=Number(query.pageSize??20);
    if(!Number.isInteger(limit)||limit<1||limit>50)throw new ApplicationError('VALIDATION_FAILED','消息分页范围为1–50');
    const result=await this.deps.repository.list(userId,limit,before);
    return{items:result.items.map(view),nextBefore:result.nextBefore};
  }
  async send(userId:string,body:Record<string,unknown>) {
    const input=aiMessageInput(userId,body);
    if(!this.deps.model.configured)throw new ApplicationError('AI_NOT_CONFIGURED','智能客服暂未配置，您仍可联系人工客服');
    const now=this.now();
    const {turn,replayed}=await this.deps.repository.claim({...input,now,leaseUntil:new Date(now.getTime()+45000)});
    if(replayed)return{turn:view(turn),replayed:true};
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const recent=await this.deps.repository.list(userId,20);
      let chars=0;
      const history=recent.items.filter(x=>x.status==='completed'&&x.reply!==null&&x.id!==turn.id).reverse().filter(x=>{chars+=x.text.length+(x.reply?.length??0);return chars<=8000;}).reverse().map(x=>({text:maskAiText(x.text),reply:maskAiText(x.reply!)}));
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ApplicationError('AI_TIMEOUT','回复超时，请稍后重试或联系人工客服'));},this.deps.timeoutMs??30000);});
      const reply=await Promise.race([this.deps.model.reply({text:maskAiText(input.text),history,signal:controller.signal}),timeout]);
      if(typeof reply!=='string'||!reply.trim()||reply.length>4000)throw new ApplicationError('AI_UNAVAILABLE','智能客服暂时无法回答，请重试或联系人工客服');
      const finished=await this.deps.repository.finish(userId,turn.id,turn.leaseId,reply.trim(),this.now());
      if(!finished)throw new ApplicationError('AI_BUSY','消息已由另一请求恢复，请刷新查看回复');
      return{turn:view({...turn,reply:reply.trim(),status:'completed'}),replayed:false};
    } catch(cause) {
      await this.deps.repository.finish(userId,turn.id,turn.leaseId,null,this.now());
      if(cause instanceof ApplicationError)throw cause;
      throw new ApplicationError('AI_UNAVAILABLE','智能客服暂时无法回答，请重试或联系人工客服');
    } finally {if(timer)clearTimeout(timer);controller.abort();}
  }
}
function view(turn:import('./ports').AiTurn){return{id:turn.id,clientMessageId:turn.clientMessageId,text:turn.text,reply:turn.reply,status:turn.status,createdAt:turn.createdAt.toISOString()};}
