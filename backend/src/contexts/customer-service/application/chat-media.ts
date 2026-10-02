import { ApplicationError, type Clock } from '../../../shared/kernel';
import type { Conversation } from '../domain/conversation';
export interface ChatImage {
  id: string; conversationId: string; actorId: string; format: string; width: number; height: number; buffer: Buffer; createdAt: Date;
}
export interface ChatImageRepository { insert(image: ChatImage): Promise<void>; findById(id: string): Promise<ChatImage|null> }
export class ChatMediaUseCase {
  constructor(private readonly deps: { conversations: {findById(id:string):Promise<Conversation|null>}; images: ChatImageRepository; inspector: {inspect(buffer:Buffer):{format:string;width:number;height:number}}; clock:Clock }) {}
  private async authorize(id:string,userId?:string,agentId?:string,writing=false):Promise<Conversation> {
    const c=await this.deps.conversations.findById(id);
    if (!c || (!userId && !agentId) || (userId && c.state.userId!==userId) || (agentId && !(writing?c.isAssignedTo(agentId):c.canRead(agentId)))) throw new ApplicationError('NOT_FOUND','会话不存在');
    if(writing&&!c.isOpen)throw new ApplicationError('CONVERSATION_ENDED','会话已结束');
    return c;
  }
  async upload(input:{conversationId:string;userId?:string;agentId?:string;buffer?:Buffer}):Promise<{id:string;width:number;height:number}> {
    await this.authorize(input.conversationId,input.userId,input.agentId,true);
    if(!input.buffer?.length)throw new ApplicationError('VALIDATION_FAILED','未接收到图片');
    const meta=this.deps.inspector.inspect(input.buffer);
    const image={id:crypto.randomUUID(),conversationId:input.conversationId,actorId:input.userId??input.agentId!,...meta,buffer:input.buffer,createdAt:this.deps.clock.now()};
    await this.deps.images.insert(image);return {id:image.id,width:image.width,height:image.height};
  }
  async read(input:{id:string;userId?:string;agentId?:string}):Promise<ChatImage> {
    const image=await this.deps.images.findById(input.id);if(!image)throw new ApplicationError('NOT_FOUND','图片不存在');
    await this.authorize(image.conversationId,input.userId,input.agentId);return image;
  }
  async assertAttachment(conversationId:string,id:string):Promise<void> {
    const image=await this.deps.images.findById(id);if(!image||image.conversationId!==conversationId)throw new ApplicationError('NOT_FOUND','图片不存在');
  }
}
