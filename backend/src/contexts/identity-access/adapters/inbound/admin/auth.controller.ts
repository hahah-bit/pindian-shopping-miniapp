import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import { RecordOperation } from '../../../../audit/application';
import { AuthenticateAdmin, LoginAdmin, LogoutAdmin } from '../../../application';
import type { RequestWithAdmin } from './admin-auth.guard';
import { PublicRoute } from './route-access';

@Controller('admin/v1/auth')
export class AuthController {
  constructor(
    @Inject(LoginAdmin) private readonly loginAdmin: LoginAdmin,
    @Inject(LogoutAdmin) private readonly logoutAdmin: LogoutAdmin,
    @Inject(AuthenticateAdmin) private readonly authenticateAdmin: AuthenticateAdmin,
    @Inject(RecordOperation) private readonly audit: RecordOperation
  ) {}

  /** 登录失败（含空凭据）由用例统一返回 UNAUTHENTICATED，不区分用户是否存在。 */
  @PublicRoute()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { username?: unknown; password?: unknown }, @Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    const result = await this.loginAdmin.execute({
      username: typeof body?.username === 'string' ? body.username : '',
      password: typeof body?.password === 'string' ? body.password : ''
    });
    await this.audit.execute({
      adminId: result.admin.id,
      action: 'admin.login',
      resourceType: 'admin_session',
      detail: { username: result.admin.username },
      requestId: request.requestId
    });
    return {
      data: { token: result.token, expiresAt: result.expiresAt.toISOString(), admin: result.admin },
      requestId: request.requestId
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: RequestWithAdmin): Promise<ApiResponse<{ revoked: true }>> {
    await this.logoutAdmin.execute(request.adminAuth?.sessionId);
    return { data: { revoked: true }, requestId: request.requestId };
  }

  /** 当前管理员资料：仅要求已认证。 */
  @Get('me')
  async me(@Req() request: RequestWithAdmin): Promise<ApiResponse<unknown>> {
    const admin = request.adminAuth!;
    return {
      data: { id: admin.adminId, username: admin.username, displayName: admin.displayName, role: admin.role, permissions: admin.permissions },
      requestId: request.requestId
    };
  }
}
