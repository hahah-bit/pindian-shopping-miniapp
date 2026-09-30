import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'pindian:public-route';
export const PERMISSIONS_KEY = 'pindian:required-permissions';

/** 标记公开路由（健康检查、平台元数据、小程序商品、图片读取、登录）。 */
export const PublicRoute = () => SetMetadata(PUBLIC_KEY, true);

/** 声明所需权限码；未标记权限的受保护路由仅要求已认证。 */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
