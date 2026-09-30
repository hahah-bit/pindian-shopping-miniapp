import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'pindian:public-route';
export const PERMISSIONS_KEY = 'pindian:required-permissions';
export const REALM_KEY = 'pindian:auth-realm';

export type AuthRealm = 'admin' | 'user';

/** 标记公开路由（健康检查、平台元数据、小程序商品、图片读取、各类登录）。 */
export const PublicRoute = () => SetMetadata(PUBLIC_KEY, true);

/** 声明认证域：admin（默认，未标记路由按 admin 处理）或 user（小程序用户会话）。 */
export const AuthRealm = (realm: AuthRealm) => SetMetadata(REALM_KEY, realm);

/** 声明所需权限码（仅 admin 域）；未标记权限的受保护路由仅要求已认证。 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
