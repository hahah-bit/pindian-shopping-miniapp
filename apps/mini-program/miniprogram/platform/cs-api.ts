import { storedUserToken, storeUserToken, UserAuthExpiredError, ApiError } from './user-auth';
export { UserAuthExpiredError, ApiError };
import { apiConfig } from './config';

/** 客服会话接口封装（T008 F035）：轮询拉取（D016）、clientMessageId 幂等。 */

interface ApiEnvelope<T> { data: T }

export interface ConversationView {
  id: string;
  status: 'queued' | 'active' | 'ended' | 'converted';
  hasAgent: boolean;
}

export interface ChatMessage {
  seq: number;
  sender: 'user' | 'agent' | 'system';
  kind: 'text' | 'image' | 'card';
  content: Record<string, unknown>;
  createdAt: string;
}

export interface TicketView {
  id: string;
  type: string;
  status: string;
  title: string;
  createdAt: string;
}

export function csRequest<T>(options: { path: string; method: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = storedUserToken();
    if (!token) {
      reject(new UserAuthExpiredError());
      return;
    }
    wx.request<ApiEnvelope<T>>({
      url: `${apiConfig.baseUrl}${options.path}`,
      method: options.method,
      data: options.body,
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      timeout: 10000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data?.data !== undefined) {
          resolve(response.data.data);
          return;
        }
        if (response.statusCode === 401) {
          storeUserToken(null);
          reject(new UserAuthExpiredError());
          return;
        }
        const errorBody = response.data as Partial<ApiEnvelope<never>> & { code?: string; message?: string };
        reject(new ApiError(errorBody.message ?? `请求失败（HTTP ${response.statusCode}）`, errorBody.code ?? 'HTTP_ERROR'));
      },
      fail() {
        reject(new ApiError('网络不可用，请稍后重试', 'NETWORK_ERROR'));
      }
    });
  });
}

export function newClientMessageId(): string {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-8${hex().slice(1)}-${hex()}${hex()}${hex().slice(0, 4)}`;
}

/** 发起/恢复会话。 */
export function openConversation(): Promise<{ conversation: ConversationView }> {
  return csRequest({ path: '/api/mini/v1/conversations', method: 'POST' });
}

/** 查询本人未结束会话；无则 conversation=null。 */
export function getCurrentConversation(): Promise<{ conversation: ConversationView | null }> {
  return csRequest({ path: '/api/mini/v1/conversations/current', method: 'GET' });
}

/** 增量拉取消息（afterSeq 断线补取）。 */
export function fetchMessages(conversationId: string, afterSeq: number): Promise<{ messages: ChatMessage[]; lastSeq: number; nextSeq: number }> {
  return csRequest({ path: `/api/mini/v1/conversations/${conversationId}/messages?afterSeq=${afterSeq}`, method: 'GET' });
}

/** 发送文本消息（幂等）。 */
export function sendText(conversationId: string, text: string, key = newClientMessageId()): Promise<{ message: { seq: number }; duplicated: boolean }> {
  return sendMessage(conversationId,{clientMessageId:key,kind:'text',content:{text}});
}

/** 发送私有图片消息（先上传到当前会话）。 */
export function sendImage(conversationId: string, mediaAssetId: string, key = newClientMessageId()): Promise<{ message: { seq: number }; duplicated: boolean }> {
  return sendMessage(conversationId,{clientMessageId:key,kind:'image',content:{mediaAssetId}});
}

/** 结束会话。 */
export function endConversation(conversationId: string): Promise<{ conversation: ConversationView }> {
  return csRequest({ path: `/api/mini/v1/conversations/${conversationId}/end`, method: 'POST' });
}

/** 本人工单列表。 */
export function listMyTickets(page = 1): Promise<{ items: TicketView[]; total: number }> {
  return csRequest({ path: `/api/mini/v1/tickets?page=${page}&pageSize=10`, method: 'GET' });
}

/** 提交工单。 */
export function createTicket(input: { type: string; title: string; description: string; orderId?: string;clientTicketId?:string }): Promise<{ ticket: { id: string; status: string } }> {
  return csRequest({ path: '/api/mini/v1/tickets', method: 'POST', body: input });
}

export interface OutgoingMessage {clientMessageId:string;kind:'text'|'image'|'card';content:Record<string,unknown>}
export function sendMessage(id:string,message:OutgoingMessage):Promise<{message:{seq:number};duplicated:boolean}> {return csRequest({path:`/api/mini/v1/conversations/${id}/messages`,method:'POST',body:{...message}});}
export function getConversation(id:string):Promise<{conversation:ConversationView}> {return csRequest({path:`/api/mini/v1/conversations/${id}`,method:'GET'});}
export function listHistory(page=1):Promise<{items:ConversationView[];total:number}> {return csRequest({path:`/api/mini/v1/conversations?page=${page}`,method:'GET'});}
export function acknowledge(id:string,seq:number):Promise<unknown> {return csRequest({path:`/api/mini/v1/conversations/${id}/read`,method:'POST',body:{seq}});}
export function cardOptions(kind:string):Promise<{items:Array<{id:string;label:string}>}> {return csRequest({path:`/api/mini/v1/cards/options/${kind}`,method:'GET'});}
export function readCard(kind:string,id:string):Promise<Record<string,unknown>> {return csRequest({path:`/api/mini/v1/cards/${kind}/${id}`,method:'GET'});}
export function uploadImage(id:string,filePath:string):Promise<{id:string}> {return new Promise((resolve,reject)=>{
  const token=storedUserToken();if(!token){reject(new UserAuthExpiredError());return;}
  wx.uploadFile({url:`${apiConfig.baseUrl}/api/mini/v1/conversations/${id}/images`,filePath,name:'file',header:{Authorization:`Bearer ${token}`},timeout:20000,success:r=>{
    try{const b=JSON.parse(r.data) as {data?:{id:string};message?:string;code?:string};if(r.statusCode===401){storeUserToken(null);reject(new UserAuthExpiredError());}else if(r.statusCode>=200&&r.statusCode<300&&b.data)resolve(b.data);else reject(new ApiError(b.message??'上传失败',b.code??'HTTP_ERROR'));}catch{reject(new ApiError('上传响应错误','HTTP_ERROR'));}
  },fail:()=>reject(new ApiError('图片上传失败，请重试','NETWORK_ERROR'))});
});}
export function downloadImage(id:string):Promise<string> {return new Promise((resolve,reject)=>{
  const token=storedUserToken();if(!token){reject(new UserAuthExpiredError());return;}
  wx.downloadFile({url:`${apiConfig.baseUrl}/api/mini/v1/chat-images/${id}`,header:{Authorization:`Bearer ${token}`},timeout:20000,success:r=>{if(r.statusCode===200)resolve(r.tempFilePath);else reject(new ApiError('图片当前不可读','HTTP_ERROR'));},fail:()=>reject(new ApiError('图片下载失败','NETWORK_ERROR'))});
});}
export interface TicketDetail {requests:Array<{id:string;kind:string;status:string;reason:string;amountFen:number|null;reviewReason:string|null;resultId:string|null}>;ticket:{ticketId:string;title:string;description:string;status:string;type:string;relatedOrderId:string|null};actions:Array<{action:string;actorType:string;detail:Record<string,unknown>;createdAt:string}>}
export function ticketDetail(id:string):Promise<TicketDetail> {return csRequest({path:`/api/mini/v1/tickets/${id}`,method:'GET'});}
export function ticketFeedback(id:string,satisfied:boolean,text:string,clientActionId:string):Promise<unknown> {return csRequest({path:`/api/mini/v1/tickets/${id}/feedback`,method:'POST',body:{satisfied,text,clientActionId}});}
