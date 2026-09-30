import { Controller, Get, Req } from '@nestjs/common';
import type { ApiResponse, PlatformInfo } from '@pindian/contracts';
import { DescribePlatform } from '../../../application/describe-platform/describe-platform';
import { PublicRoute } from '../../../../contexts/identity-access/adapters/inbound/admin/route-access';

@Controller()
export class PlatformController {
  constructor(private readonly describe: DescribePlatform) {}

  @PublicRoute()
  @Get(['mini/v1/platform', 'admin/v1/platform'])
  platform(@Req() request: { requestId: string }): ApiResponse<PlatformInfo> {
    return { data: this.describe.execute(), requestId: request.requestId };
  }
}
