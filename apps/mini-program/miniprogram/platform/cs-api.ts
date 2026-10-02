import { storedUserToken, UserAuthExpiredError, ApiError } from './user-auth';
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

function request<T>(options: { path: string; method: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<T> {
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

function newClientMessageId(): string {
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-8${hex().slice(1)}-${hex()}${hex()}${hex().slice(0, 4)}`;
}

/** 发起/恢复会话。 */
export function openConversation(): Promise<{ conversation: ConversationView }> {
  return request({ path: '/api/mini/v1/conversations', method: 'POST' });
}

/** 查询本人未结束会话；无则 conversation=null。 */
export function getCurrentConversation(): Promise<{ conversation: ConversationView | null }> {
  return request({ path: '/api/mini/v1/conversations/current', method: 'GET' });
}

/** 增量拉取消息（afterSeq 断线补取）。 */
export function fetchMessages(conversationId: string, afterSeq: number): Promise<{ messages: ChatMessage[]; lastSeq: number }> {
  return request({ path: `/api/mini/v1/conversations/${conversationId}/messages?afterSeq=${afterSeq}`, method: 'GET' });
}

/** 发送文本消息（幂等）。 */
export function sendText(conversationId: string, text: string): Promise<{ message: { seq: number }; duplicated: boolean }> {
  return request({ path: `/api/mini/v1/conversations/${conversationId}/messages`, method: 'POST', body: { clientMessageId: newClientMessageId(), kind: 'text', content: { text } } });
}

/** 发送图片消息（先经 T006 图片库上传取 assetId）。 */
export function sendImage(conversationId: string, mediaAssetId: string): Promise<{ message: { seq: number }; duplicated: boolean }> {
  return request({ path: `/api/mini/v1/conversations/${conversationId}/messages`, method: 'POST', body: { clientMessageId: newClientMessageId(), kind: 'image', content: { mediaAssetId } } });
}

/** 结束会话。 */
export function endConversation(conversationId: string): Promise<{ conversation: ConversationView }> {
  return request({ path: `/api/mini/v1/conversations/${conversationId}/end`, method: 'POST' });
}

/** 本人工单列表。 */
export function listMyTickets(page = 1): Promise<{ items: TicketView[]; total: number }> {
  return request({ path: `/api/mini/v1/tickets?page=${page}&pageSize=10`, method: 'GET' });
}

/** 提交工单。 */
export function createTicket(input: { type: string; title: string; description: string; orderId?: string }): Promise<{ ticket: { id: string; status: string } }> {
  return request({ path: '/api/mini/v1/tickets', method: 'POST', body: input });
}
