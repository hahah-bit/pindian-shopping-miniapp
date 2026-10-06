import { ArgumentsHost, Catch, HttpException, PayloadTooLargeException, UnsupportedMediaTypeException, type ExceptionFilter } from '@nestjs/common';
import { ApplicationError } from '../shared/kernel';

const APPLICATION_ERROR_STATUS: Record<string, number> = {
  VALIDATION_FAILED: 400,
  AI_NOT_CONFIGURED:503, AI_BUSY:409, AI_UNAVAILABLE:502, AI_TIMEOUT:504,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRODUCT_NOT_PUBLISHABLE: 409,
  MEDIA_IN_USE: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  STORAGE_UNAVAILABLE: 503,
  MEDIA_SAVE_FAILED: 500,
  DEPENDENCY_UNAVAILABLE: 503,
  WECHAT_NOT_CONFIGURED: 503,
  NOTIFY_INVALID: 400,
  WECHAT_UNAVAILABLE: 502,
  WECHAT_CODE_INVALID: 401,
  WECHAT_RISK_BLOCKED: 403,
  USER_DISABLED: 403,
  PHONE_CODE_INVALID: 400,
  ADDRESS_LIMIT_REACHED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SHARE_CAPACITY_CONFLICT: 409,
  STOCK_INSUFFICIENT: 409,
  GROUP_NOT_JOINABLE: 409,
  PRODUCT_NOT_ON_SHELF: 409,
  ORDER_NOT_CANCELLABLE: 409,
  ADDRESS_NOT_FOUND: 404,
  SHARE_UNIT_INVALID: 400,
  WECHAT_PAY_NOT_CONFIGURED: 503,
  WECHAT_PAY_CHANNEL_ERROR: 502,
  REFUND_NOT_ALLOWED: 409,
  QUANTITY_EXCEEDS_ALLOCATION: 409,
  SHIPMENT_DUPLICATE_TRACKING: 409,
  FULFILLMENT_NOT_SHIPPABLE: 409,
  RECEIVER_LOCKED: 409,
  EXPORT_AUDIT_FAILED: 503,
  CONVERSATION_NOT_QUEUED: 409,
  CONVERSATION_ENDED: 409,
  MESSAGE_ID_CONFLICT: 409,
  AGENT_NOT_ONLINE: 409,
  TICKET_STATE_CONFLICT: 409,
  APPROVAL_STATE_CONFLICT: 409,
  ORDER_REFUND_HELD: 409,
  REVIEW_REQUIRED: 409,
  REFUND_EXCEED_LIMIT: 409,
  DELIVERY_NOT_RETRYABLE: 409
};

const STATUS_CODE_TEXT: Record<number, string> = {
  400: '请求参数不正确',
  401: '未认证或凭证已失效',
  403: '没有该操作权限',
  404: '资源不存在',
  409: '请求与当前状态冲突',
  413: '请求体超过大小限制',
  415: '格式不支持',
  429: '尝试过于频繁，请稍后再试',
  503: '依赖服务暂不可用'
};

function statusToCode(status: number): string {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'DEPENDENCY_UNAVAILABLE';
  if (status === 400) return 'VALIDATION_FAILED';
  return 'HTTP_ERROR';
}

interface MulterLikeError {
  name: string;
  code?: string;
  message?: string;
}

/** 统一错误出口：映射应用错误码与常见 HTTP/上传异常；不泄露堆栈与内部信息。 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ requestId: string }>();
    const response = http.getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>();

    let status = 500;
    let code = 'HTTP_ERROR';
    let message = '请求处理失败';
    let details: string[] | undefined;

    if (error instanceof ApplicationError) {
      status = APPLICATION_ERROR_STATUS[error.code] ?? 500;
      code = error.code;
      message = error.message;
      details = error.details?.length ? error.details : undefined;
    } else if (isMulterError(error)) {
      status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED';
      message = status === 413 ? '文件超过 5 MiB 大小限制' : '文件上传失败';
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = statusToCode(status);
      message = STATUS_CODE_TEXT[status] ?? '请求处理失败';
      if (error instanceof PayloadTooLargeException || error instanceof UnsupportedMediaTypeException) {
        const response_ = error.getResponse();
        if (typeof response_ === 'object' && response_ !== null && 'message' in response_) {
          const inner = (response_ as { message: unknown }).message;
          if (typeof inner === 'string' && inner) message = inner;
        }
      }
    } else if (isEntityTooLarge(error)) {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = '请求体超过大小限制';
    }

    if (status >= 500) {
      // 未识别异常必须留服务端证据（不向客户端泄露内部细节）
      console.error('[http] 未处理异常', error);
    }
    response.status(status).json({ code, message, requestId: request.requestId, ...(details ? { details } : {}) });
  }
}

function isMulterError(error: unknown): error is MulterLikeError {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: unknown }).name === 'MulterError';
}

function isEntityTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { type?: unknown }).type === 'entity.too.large' || /request entity too large/i.test(String((error as Error).message ?? '')))
  );
}
