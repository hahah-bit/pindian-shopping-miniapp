import {ApplicationError} from '../../../shared/kernel';
export function aiMessageInput(userId:unknown,body:Record<string,unknown>):{userId:string;clientMessageId:string;text:string} {
  if(typeof userId!=='string'||!userId)throw new ApplicationError('UNAUTHENTICATED','请先登录后咨询');
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ApplicationError('VALIDATION_FAILED','消息请求格式无效');
  const text=typeof body.text==='string'?body.text.trim():'';
  const clientMessageId=body.clientMessageId;
  if(!text||text.length>1000||typeof clientMessageId!=='string'||!isUuid(clientMessageId))throw new ApplicationError('VALIDATION_FAILED','请输入1–1000字消息，并提供有效消息标识');
  return{userId,clientMessageId,text};
}
export function isUuid(value:string):boolean{return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
export function maskAiText(text:string):string{return text.replace(/\b1[3-9]\d{9}\b/g,'[手机号已隐藏]').replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/gi,'[凭据已隐藏]');}
