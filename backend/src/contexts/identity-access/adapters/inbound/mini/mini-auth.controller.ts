import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { ApiResponse, MiniLoginResponse, MiniUserView } from '@pindian/contracts';
import { maskPhone } from '../../../domain/user/user';
import { LoginWithWechat } from '../../../application/user/wechat-login';
import type { RequestWithPrincipal } from '../admin/access.guard';
import { AuthRealm, PublicRoute } from '../admin/route-access';

@Controller('mini/v1/auth')
export class MiniAuthController {
  constructor(
    @Inject(LoginWithWechat) private readonly loginWithWechat: LoginWithWechat,
    @Inject('USER_SESSION_REPOSITORY') private readonly sessions: { findBySessionId(id: string): Promise<object | null>; revoke(id: string, at: Date): Promise<void> },
    @Inject('CLOCK') private readonly clock: { now(): Date }
  ) {}

  @PublicRoute()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { code?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<MiniLoginResponse>> {
    const result = await this.loginWithWechat.execute({ code: body?.code });
    return {
      data: {
        token: result.token,
        expiresAt: result.expiresAt.toISOString(),
        isNewUser: result.isNewUser,
        user: { ...result.user, createdAt: result.user.createdAt.toISOString() }
      },
      requestId: request.requestId
    };
  }

  @AuthRealm('user')
  @Get('me')
  async me(@Req() request: RequestWithPrincipal): Promise<ApiResponse<MiniUserView>> {
    const auth = request.userAuth!;
    return {
      data: {
        id: auth.userId,
        nickname: auth.nickname,
        hasPhone: auth.hasPhone,
        ...(auth.phone ? { phoneMasked: maskPhone(auth.phone) } : {}),
        ...(auth.phone ? { phoneVerified: auth.phoneVerifiedAt != null } : {}),
        status: auth.status,
        createdAt: auth.createdAt.toISOString()
      },
      requestId: request.requestId
    };
  }

  @AuthRealm('user')
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: RequestWithPrincipal): Promise<ApiResponse<{ revoked: true }>> {
    const sessionId = request.userAuth?.sessionId;
    if (sessionId) {
      const session = await this.sessions.findBySessionId(sessionId);
      if (session) await this.sessions.revoke(sessionId, this.clock.now());
    }
    return { data: { revoked: true }, requestId: request.requestId };
  }
}
