import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { ApiResponse, AddressView, MiniUserView, PhoneBindResult, ProfileUpdateRequest, AddressSaveRequest } from '@pindian/contracts';
import { ApplicationError } from '../../../../../shared/kernel';
import { maskPhone } from '../../../domain/user/user';
import { BindPhone, UpdateProfile } from '../../../application/user/wechat-login';
import { CreateAddress, DeleteAddress, ListMyAddresses, SetDefaultAddress, UpdateAddress } from '../../../application/user/address-use-cases';
import type { RequestWithPrincipal } from '../admin/access.guard';
import { AuthRealm } from '../admin/route-access';

function iso(value: Date): string {
  return value.toISOString();
}

function addressView(view: Awaited<ReturnType<CreateAddress['execute']>>): AddressView {
  return { ...view, createdAt: iso(view.createdAt), updatedAt: iso(view.updatedAt) };
}

/** 小程序用户资料：昵称与手机号绑定（user realm）。 */
@Controller('mini/v1/auth')
export class MiniProfileController {
  constructor(
    @Inject(BindPhone) private readonly bindPhoneCase: BindPhone,
    @Inject(UpdateProfile) private readonly updateProfileCase: UpdateProfile
  ) {}

  @AuthRealm('user')
  @Patch('profile')
  async updateProfile(@Body() body: ProfileUpdateRequest, @Req() request: RequestWithPrincipal): Promise<ApiResponse<MiniUserView>> {
    const auth = request.userAuth!;
    const updated = await this.updateProfileCase.execute({ userId: auth.userId, nickname: body?.nickname });
    return {
      data: {
        id: updated.id,
        nickname: updated.nickname,
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
  @Post('phone')
  @HttpCode(200)
  async bindPhoneNumber(@Body() body: { code?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<PhoneBindResult>> {
    const auth = request.userAuth!;
    const result = await this.bindPhoneCase.execute({ userId: auth.userId, code: body?.code });
    return { data: result, requestId: request.requestId };
  }
}

/** 小程序收货地址：归属由服务端强制（user realm，全部以 token 用户为作用域）。 */
@Controller('mini/v1/addresses')
export class MiniAddressesController {
  constructor(
    @Inject(ListMyAddresses) private readonly listAddresses: ListMyAddresses,
    @Inject(CreateAddress) private readonly createAddress: CreateAddress,
    @Inject(UpdateAddress) private readonly updateAddress: UpdateAddress,
    @Inject(DeleteAddress) private readonly deleteAddress: DeleteAddress,
    @Inject(SetDefaultAddress) private readonly setDefaultAddress: SetDefaultAddress
  ) {}

  private userId(request: RequestWithPrincipal): string {
    const userId = request.userAuth?.userId;
    if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    return userId;
  }

  @AuthRealm('user')
  @Get()
  async list(@Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: AddressView[] }>> {
    const result = await this.listAddresses.execute({ userId: this.userId(request) });
    return { data: { items: result.items.map(addressView) }, requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post()
  async create(@Body() body: AddressSaveRequest, @Req() request: RequestWithPrincipal): Promise<ApiResponse<AddressView>> {
    const view = await this.createAddress.execute({ userId: this.userId(request), input: body });
    return { data: addressView(view), requestId: request.requestId };
  }

  @AuthRealm('user')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: AddressSaveRequest, @Req() request: RequestWithPrincipal): Promise<ApiResponse<AddressView>> {
    const view = await this.updateAddress.execute({ userId: this.userId(request), addressId: id, input: body });
    return { data: addressView(view), requestId: request.requestId };
  }

  @AuthRealm('user')
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ deleted: true }>> {
    return { data: await this.deleteAddress.execute({ userId: this.userId(request), addressId: id }), requestId: request.requestId };
  }

  @AuthRealm('user')
  @Put(':id/default')
  @HttpCode(200)
  async setDefault(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: AddressView[] }>> {
    const result = await this.setDefaultAddress.execute({ userId: this.userId(request), addressId: id });
    return { data: { items: result.items.map(addressView) }, requestId: request.requestId };
  }
}
