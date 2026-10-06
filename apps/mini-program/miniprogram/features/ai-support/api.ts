import type { AiSupportTurnView, AiSupportHistoryView } from '@pindian/contracts';
import { csRequest } from '../../platform/cs-api';
export function listAiMessages(before?: string): Promise<AiSupportHistoryView> {
  return csRequest({path: `/api/mini/v1/ai-support/messages?pageSize=20${before ? '&before='+encodeURIComponent(before) : ''}`, method:'GET'});
}
export function sendAiMessage(text: string, clientMessageId: string): Promise<{turn:AiSupportTurnView;replayed:boolean}> {
  return csRequest({path:'/api/mini/v1/ai-support/messages',method:'POST',body:{text,clientMessageId},timeoutMs:35000});
}
