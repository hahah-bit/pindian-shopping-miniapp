import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiResponse, AdminPhoneReveal, AdminUserListItem } from '@pindian/contracts';
import { RecordOperation } from '../../../../audit/application';
import { DisableUser, EnableUser, GetAdminUser, ListAdminUsers, RevealUserPhone } from '../../../application/user/admin-users';
import type { RequestWithPrincipal } from './access.guard';
import { RequirePermissions } from './route-access';

function iso(value: Date | undefined): string {
  return (value ?? new Date(0)).toISOString();
}

/** 后台用户管理：user:manage 权限；列表/详情默认脱敏，完整手机号单独端点强制审计。 */
@Controller('admin/v1/users')
export class AdminUsersController {
  constructor(
    @Inject(ListAdminUsers) private readonly listUsers: ListAdminUsers,
    @Inject(GetAdminUser) private readonly getUser: GetAdminUser,
    @Inject(RevealUserPhone) private readonly revealPhone: RevealUserPhone,
    @Inject(DisableUser) private readonly disableUser: DisableUser,
    @Inject(EnableUser) private readonly enableUser: EnableUser,
    @Inject(RecordOperation) private readonly audit: RecordOperation
  ) {}

  private adminId(request: RequestWithPrincipal): string | null {
    return request.adminAuth?.adminId ?? null;
  }

  @Get()
  @RequirePermissions('user:manage')
  async list(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: AdminUserListItem[]; page: number; pageSize: number; total: number }>> {
    const result = await this.listUsers.execute({
      keyword: query.keyword,
      status: query.status,
      page: query.page === undefined ? undefined : Number(query.page),
      pageSize: query.pageSize === undefined ? undefined : Number(query.pageSize)
    });
    return {
      data: {
        ...result,
        items: result.items.map((item) => ({ ...item, createdAt: iso(item.createdAt), lastLoginAt: item.lastLoginAt ? iso(item.lastLoginAt) : undefined }))
      },
      requestId: request.requestId
    };
  }

  @Get(':id')
  @RequirePermissions('user:manage')
  async get(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<AdminUserListItem>> {
    const view = await this.getUser.execute({ userId: id });
    return { data: { ...view, createdAt: iso(view.createdAt), lastLoginAt: view.lastLoginAt ? iso(view.lastLoginAt) : undefined }, requestId: request.requestId };
  }

  @Get(':id/phone')
  @RequirePermissions('user:manage')
  async reveal(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<AdminPhoneReveal>> {
    const result = await this.revealPhone.execute({ userId: id, adminId: this.adminId(request), requestId: request.requestId });
    return { data: result, requestId: request.requestId };
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermissions('user:manage')
  async disable(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<AdminUserListItem>> {
    const view = await this.disableUser.execute({ userId: id, adminId: this.adminId(request), requestId: request.requestId });
    return { data: { ...view, createdAt: iso(view.createdAt), lastLoginAt: view.lastLoginAt ? iso(view.lastLoginAt) : undefined }, requestId: request.requestId };
  }

  @Post(':id/enable')
  @HttpCode(200)
  @RequirePermissions('user:manage')
  async enable(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<AdminUserListItem>> {
    const view = await this.enableUser.execute({ userId: id, adminId: this.adminId(request), requestId: request.requestId });
    return { data: { ...view, createdAt: iso(view.createdAt), lastLoginAt: view.lastLoginAt ? iso(view.lastLoginAt) : undefined }, requestId: request.requestId };
  }
}
