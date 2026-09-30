import { Controller, Get, Header, Inject, Req, ServiceUnavailableException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiResponse, HealthInfo } from '@pindian/contracts';
import { CheckReadiness } from '../../../application/check-readiness/check-readiness';
import { PublicRoute } from '../../../../contexts/identity-access/adapters/inbound/admin/route-access';

@Controller('health')
export class HealthController {
  constructor(@Inject(CheckReadiness) private readonly readiness: CheckReadiness) {}

  @PublicRoute()
  @Get('live')
  live(@Req() request: { requestId: string }): ApiResponse<HealthInfo> {
    return { data: { status: 'live', checkedAt: new Date().toISOString() }, requestId: request.requestId };
  }

  @PublicRoute()
  @Get('ready')
  async ready(@Req() request: { requestId: string }): Promise<ApiResponse<HealthInfo>> {
    if (!(await this.readiness.execute())) throw new ServiceUnavailableException('依赖服务暂不可用');
    return { data: { status: 'ready', checkedAt: new Date().toISOString() }, requestId: request.requestId };
  }

  @PublicRoute()
  @Get('openapi')
  @Header('Content-Type', 'application/yaml; charset=utf-8')
  openapi(): string {
    return readFileSync(resolve(__dirname, '../../../../../../contracts/openapi.yaml'), 'utf8');
  }
}
