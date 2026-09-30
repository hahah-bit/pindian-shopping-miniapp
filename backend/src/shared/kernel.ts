/**
 * 共享内核：仅限跨上下文复用的稳定抽象，禁止业务逻辑。
 * 依赖方向：领域/应用可依赖此处；此处不依赖任何上下文与框架。
 */

/** 应用层可抛出的业务错误；HTTP 状态映射由入口适配器完成。 */
export class ApplicationError extends Error {
  readonly code: string;
  readonly details?: string[];

  constructor(code: string, message: string, details?: string[]) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.details = details;
  }
}

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PRODUCT_NOT_PUBLISHABLE',
  'MEDIA_IN_USE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMITED',
  'STORAGE_UNAVAILABLE',
  'MEDIA_SAVE_FAILED',
  'DEPENDENCY_UNAVAILABLE'
] as const;

export type ApplicationErrorCode = (typeof ERROR_CODES)[number];

/** 时钟端口：领域与应用不直接 new Date，便于冻结时间测试。 */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * 事务端口：应用声明事务边界，适配器实现具体机制。
 * 会话句柄为不透明值，由各仓储适配器自行解释（如 pg 客户端）。
 */
export interface TransactionRunner {
  run<T>(work: (session: unknown) => Promise<T>): Promise<T>;
}
