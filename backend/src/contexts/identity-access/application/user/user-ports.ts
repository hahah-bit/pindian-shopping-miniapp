import type { User } from '../../domain/user/user';
import type { WechatIdentity } from '../../domain/user/wechat-identity';
import type { UserSession } from '../../domain/user/user-session';
import type { WxAuthPort, WxPhonePort } from './wx-ports';

// ---------- 用户域仓储 ----------

export interface UserRepository {
  findById(userId: string): Promise<User | null>;
  findByIdIfActive(userId: string): Promise<User | null>;
  save(user: User): Promise<void>;
  /** F012：状态更新（禁用/启用），返回是否存在。 */
  updateStatus(userId: string, status: 'active' | 'disabled', at: Date): Promise<boolean>;
  /** 用户行锁（设默认地址等用户级串行化）；仅事务会话内调用。 */
  lockById?(userId: string, sessionTx: unknown): Promise<void>;
  /** F012：分页列表（keyword 按昵称、status 过滤）。 */
  listUsers(query: { keyword?: string | null; status?: string | null; page: number; pageSize: number }): Promise<{ items: User[]; total: number }>;
}

export interface WechatIdentityRepository {
  findByOpenid(openid: string): Promise<WechatIdentity | null>;
  findByUserId(userId: string): Promise<WechatIdentity | null>;
  insert(identity: WechatIdentity): Promise<void>;
}

export interface UserSessionRepository {
  save(session: UserSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<UserSession | null>;
  findBySessionId(sessionId: string): Promise<UserSession | null>;
  revoke(sessionId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export interface UserTokenService {
  generate(): string;
  hash(token: string): string;
}

// ---------- 用户域用例输入输出 ----------

export interface MiniUserProfile {
  id: string;
  nickname: string;
  hasPhone: boolean;
  phoneMasked?: string;
  phoneVerified?: boolean;
  status: 'active' | 'disabled';
  createdAt: Date;
}

export interface LoginWithWechatDeps {
  users: UserRepository;
  identities: WechatIdentityRepository;
  sessions: UserSessionRepository;
  tokens: UserTokenService;
  wxAuth: WxAuthPort;
  clock: { now(): Date };
  sessionTtlMinutes: number;
  /** 登录事务执行器：用户创建、身份绑定、会话签发原子提交。 */
  runner: { run<T>(work: () => Promise<T>): Promise<T> };
}

export interface LoginWithWechatResult {
  token: string;
  expiresAt: Date;
  isNewUser: boolean;
  user: MiniUserProfile;
}

export interface AuthenticatedUser {
  sessionId: string;
  userId: string;
  nickname: string;
  status: 'active' | 'disabled';
  phone: string | null;
  phoneVerifiedAt: Date | null;
  hasPhone: boolean;
  phoneMasked?: string;
  createdAt: Date;
  openid: string | null;
}

export { WxPhonePort };
