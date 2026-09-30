import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApplicationError } from '../../../../../shared/kernel';
import type { AuthenticateAdmin, AuthenticatedAdmin } from '../../../application/authenticate-admin';
import type { AuthenticateUser } from '../../../application/user/wechat-login';
import type { AuthenticatedUser } from '../../../application/user/user-ports';
import { PERMISSIONS_KEY, PUBLIC_KEY, REALM_KEY, type AuthRealm } from './route-access';

export interface RequestWithPrincipal {
  requestId: string;
  adminAuth?: AuthenticatedAdmin;
  userAuth?: AuthenticatedUser;
  headers: Record<string, unknown>;
}

/**
 * 全局守卫（realm 分派）：
 * - @PublicRoute → 放行；
 * - @AuthRealm('user') → 校验用户会话；
 * - 其余（默认 admin 域）→ 校验管理员会话与权限码，默认拒绝。
 * 前端隐藏按钮不是权限防线。
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authenticateAdmin: AuthenticateAdmin,
    private readonly authenticateUser: AuthenticateUser
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithPrincipal>();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('未提供访问凭证');
    }
    const token = header.slice('Bearer '.length).trim();
    const realm = this.reflector.getAllAndOverride<AuthRealm | undefined>(REALM_KEY, [context.getHandler(), context.getClass()]);

    if (realm === 'user') {
      try {
        request.userAuth = await this.authenticateUser.execute(token);
      } catch (error) {
        if (error instanceof ApplicationError && (error.code === 'UNAUTHENTICATED' || error.code === 'USER_DISABLED')) {
          throw new UnauthorizedException(error.code === 'USER_DISABLED' ? '账号已被禁用' : '访问凭证无效或已过期');
        }
        throw error;
      }
      return true;
    }

    let admin: AuthenticatedAdmin;
    try {
      admin = await this.authenticateAdmin.execute(token);
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'UNAUTHENTICATED') {
        throw new UnauthorizedException('访问凭证无效或已过期');
      }
      throw error;
    }
    request.adminAuth = admin;

    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (required && !required.every((permission) => admin.permissions.includes(permission))) {
      throw new ForbiddenException('当前角色没有该操作权限');
    }
    return true;
  }
}
