/**
 * 登录限流（进程内策略对象）：同用户名连续失败达到上限后锁定一个窗口。
 * 单实例假设见 docs/architecture.md；多实例部署时需替换为共享存储实现。
 */
export interface LoginThrottleOptions {
  maxAttempts: number;
  lockWindowMs: number;
}

interface FailureRecord {
  count: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly failures = new Map<string, FailureRecord>();

  constructor(private readonly options: LoginThrottleOptions) {
    if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1) {
      throw new Error('maxAttempts 必须为正整数');
    }
    if (!Number.isInteger(options.lockWindowMs) || options.lockWindowMs < 1000) {
      throw new Error('lockWindowMs 必须为不小于 1000 的整数毫秒');
    }
  }

  lockedRemainingMs(username: string, now: Date): number {
    const record = this.failures.get(username);
    if (!record || record.lockedUntil <= now.getTime()) return 0;
    return record.lockedUntil - now.getTime();
  }

  isLocked(username: string, now: Date): boolean {
    return this.lockedRemainingMs(username, now) > 0;
  }

  recordFailure(username: string, now: Date): void {
    const record = this.failures.get(username) ?? { count: 0, lockedUntil: 0 };
    record.count += 1;
    if (record.count >= this.options.maxAttempts) {
      record.lockedUntil = now.getTime() + this.options.lockWindowMs;
      record.count = 0;
    }
    this.failures.set(username, record);
  }

  reset(username: string): void {
    this.failures.delete(username);
  }
}
