import type { ChatImage, ChatImageRepository } from '../../../application/chat-media';
import {withExecutor,type PgExecutor} from '../../../../../adapters-shared/pg-client';
export class PostgresChatImageRepository implements ChatImageRepository {
  constructor(private readonly pool:PgExecutor){}
  async insert(a:ChatImage):Promise<void>{await withExecutor(this.pool,c=>c.query('INSERT INTO cs_images(id,conversation_id,actor_id,format,width,height,bytes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,a.conversationId,a.actorId,a.format,a.width,a.height,a.buffer,a.createdAt]));}
  async findById(id:string):Promise<ChatImage|null>{return withExecutor(this.pool,async c=>{
    const {rows}=await c.query('SELECT * FROM cs_images WHERE id=$1',[id]);const a=rows[0];return a?{id:a.id,conversationId:a.conversation_id,actorId:a.actor_id,format:a.format,width:a.width,height:a.height,buffer:a.bytes,createdAt:a.created_at}:null;
  });}
}
