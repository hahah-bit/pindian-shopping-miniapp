import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApplicationError } from '../../../../../shared/kernel';
import type { AuthenticateAdmin, AuthenticatedAdmin } from '../../../application';
import { PERMISSIONS_KEY, PUBLIC_KEY } from './route-access';

export interface RequestWithAdmin {
  requestId: string;
  adminAuth?: AuthenticatedAdmin;
  headers: Record<string, unknown>;
}

/**
 * 全局守卫：默认拒绝（未标记 @PublicRoute 的路由必须携带有效 Bearer token）；
 * 权限码不匹配返回 403。前端隐藏按钮不是权限防线。
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly authenticate: AuthenticateAdmin) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithAdmin>();
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('未提供访问凭证');
    }
    let admin: AuthenticatedAdmin;
    try {
      admin = await this.authenticate.execute(header.slice('Bearer '.length).trim());
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
