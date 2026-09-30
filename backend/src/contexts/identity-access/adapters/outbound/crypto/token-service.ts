import { createHash, randomBytes } from 'node:crypto';
import type { AdminTokenService } from '../../../application/ports';

/** 会话 token：32 字节随机 base64url 原文；存储与查询只使用 sha256 哈希。 */
export class TokenService implements AdminTokenService {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
