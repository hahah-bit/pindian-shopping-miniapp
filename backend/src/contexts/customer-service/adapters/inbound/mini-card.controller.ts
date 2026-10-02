import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import { ApplicationError } from '../../../../shared/kernel';
import type { RequestWithPrincipal } from '../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm } from '../../../identity-access/adapters/inbound/admin/route-access';
import { CardProjectionUseCase, type CardProjectionDeps } from '../../application/card-projection';
@Controller('mini/v1/cards')
export class MiniCardController {
  private readonly projection: CardProjectionUseCase;
  constructor(@Inject('CARD_PROJECTION_DEPS') deps: CardProjectionDeps) { this.projection = new CardProjectionUseCase(deps); }
  @AuthRealm('user')
  @Get('options/:kind')
  async options(@Param('kind')kind:string,@Req()r:RequestWithPrincipal){return {data:{items:await this.projection.options(r.userAuth!.userId,kind)},requestId:r.requestId};}
  @AuthRealm('user')
  @Get(':kind/:id')
  async read(@Param('kind') kind: string, @Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const userId = request.userAuth?.userId;
    if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    return { data: await this.projection.execute(userId, kind, id), requestId: request.requestId };
  }
}
