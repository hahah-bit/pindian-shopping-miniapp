import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {ApplicationError} from '../../../../../shared/kernel';
import type {AiSupportRepository,AiTurn,AiReplyResult} from '../../../application/ai-support/ports';
type Row={id:string;user_id:string;client_message_id:string;text:string;reply:string|null;status:AiTurn['status'];lease_id:string;created_at:Date;intent:AiTurn['intent'];recommendations:AiTurn['recommendations']};
const turn=(r:Row):AiTurn=>({id:r.id,userId:r.user_id,clientMessageId:r.client_message_id,text:r.text,reply:r.reply,status:r.status,leaseId:r.lease_id,createdAt:r.created_at,intent:r.intent??'general',recommendations:r.recommendations??[]});
export class PostgresAiSupportRepository implements AiSupportRepository {
 constructor(private readonly pool:Pool){}
 async claim(input:{userId:string;clientMessageId:string;text:string;now:Date;leaseUntil:Date}){
  const c=await this.pool.connect();
  try {
   await c.query('BEGIN');
   await c.query('INSERT INTO ai_support_conversations(user_id) VALUES($1) ON CONFLICT DO NOTHING',[input.userId]);
   const {rows:[state]}=await c.query<{window_started_at:Date;window_requests:number}>('SELECT * FROM ai_support_conversations WHERE user_id=$1 FOR UPDATE',[input.userId]);
   const {rows:[duplicate]}=await c.query<Row>('SELECT * FROM ai_support_turns WHERE user_id=$1 AND client_message_id=$2',[input.userId,input.clientMessageId]);
   if(duplicate&&duplicate.text!==input.text)throw new ApplicationError('IDEMPOTENCY_CONFLICT','相同消息标识不能用于不同内容');
   if(duplicate?.status==='completed'){await c.query('COMMIT');return{turn:turn(duplicate),replayed:true};}
   const active=await c.query('SELECT id FROM ai_support_turns WHERE user_id=$1 AND status=\'pending\' AND lease_expires_at>$2 LIMIT 1',[input.userId,input.now]);
   if(active.rowCount)throw new ApplicationError('AI_BUSY','上一条消息正在回复，请稍后重试');
   const reset=!state||input.now.getTime()-state.window_started_at.getTime()>=60000;
   if(!reset&&state.window_requests>=10)throw new ApplicationError('RATE_LIMITED','咨询较频繁，请一分钟后再试');
   await c.query('UPDATE ai_support_conversations SET window_started_at=$2,window_requests=$3 WHERE user_id=$1',[input.userId,reset?input.now:state!.window_started_at,reset?1:state!.window_requests+1]);
   const leaseId=randomUUID();let row:Row;
   if(duplicate){const r=await c.query<Row>('UPDATE ai_support_turns SET status=\'pending\',reply=NULL,intent=\'general\',recommendations=\'[]\'::jsonb,lease_id=$3,lease_expires_at=$4,updated_at=$5 WHERE user_id=$1 AND id=$2 RETURNING *',[input.userId,duplicate.id,leaseId,input.leaseUntil,input.now]);row=r.rows[0]!;}
   else {const r=await c.query<Row>('INSERT INTO ai_support_turns(id,user_id,client_message_id,text,status,lease_id,lease_expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,\'pending\',$5,$6,$7,$7) RETURNING *',[randomUUID(),input.userId,input.clientMessageId,input.text,leaseId,input.leaseUntil,input.now]);row=r.rows[0]!;}
   await c.query('COMMIT');return{turn:turn(row),replayed:false};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async list(userId:string,limit:number,before?:string){
  let anchor:Row|undefined;
  if(before){anchor=(await this.pool.query<Row>('SELECT * FROM ai_support_turns WHERE user_id=$1 AND id=$2',[userId,before])).rows[0];if(!anchor)throw new ApplicationError('NOT_FOUND','消息游标不存在');}
  const params:unknown[]=[userId,limit+1];
  const condition=anchor?'AND (created_at,id)<($3::timestamptz,$4::uuid)':'';if(anchor)params.push(anchor.created_at,anchor.id);
  const {rows}=await this.pool.query<Row>(`SELECT * FROM ai_support_turns WHERE user_id=$1 ${condition} ORDER BY created_at DESC,id DESC LIMIT $2`,params);
  const selected=rows.slice(0,limit).reverse();return{items:selected.map(turn),nextBefore:rows.length>limit?selected[0]!.id:null};
 }
 async finish(userId:string,id:string,leaseId:string,reply:string|null,now:Date,metadata?:Pick<AiReplyResult,'intent'|'recommendations'>){
  const r=await this.pool.query('UPDATE ai_support_turns SET reply=$4,status=$5,updated_at=$6,intent=$7,recommendations=$8::jsonb WHERE user_id=$1 AND id=$2 AND lease_id=$3 AND status=\'pending\'',[userId,id,leaseId,reply,reply===null?'failed':'completed',now,reply===null?'general':metadata?.intent??'general',JSON.stringify(reply===null?[]:metadata?.recommendations??[])]);return r.rowCount===1;
 }
}
