export interface AiTurn {
  id:string; userId:string; clientMessageId:string; text:string; reply:string|null;
  status:'pending'|'completed'|'failed'; createdAt:Date; leaseId:string;
}
export interface AiSupportRepository {
  claim(input:{userId:string;clientMessageId:string;text:string;now:Date;leaseUntil:Date}):Promise<{turn:AiTurn;replayed:boolean}>;
  list(userId:string,limit:number,before?:string):Promise<{items:AiTurn[];nextBefore:string|null}>;
  finish(userId:string,id:string,leaseId:string,reply:string|null,now:Date):Promise<boolean>;
}
export interface AiReplyPort {
  readonly configured:boolean;
  reply(input:{history:Array<{text:string;reply:string}>;text:string;signal:AbortSignal}):Promise<string>;
}
