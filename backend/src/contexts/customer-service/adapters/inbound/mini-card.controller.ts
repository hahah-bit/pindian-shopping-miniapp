import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { ApiResponse } from '@pindian/contracts';
import { ApplicationError } from '../../../../shared/kernel';
import type { RequestWithPrincipal } from '../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm } from '../../../identity-access/adapters/inbound/admin/route-access';

export interface CardProjectionDeps {
  product: {
    findById(id: string): Promise<{
      state: { productId: string; name: string; status: string; unit: string; snapshot: { originalPriceFen: number; wholeQuantityText: string }; mainImage: unknown };
    } | null>;
  };
  orders: { findById(id: string): Promise<{ state: { orderId: string; userId: string; orderNo: string; status: string; units: number; totalAmountFen: number; createdAt: Date } } | null> };
  groups: { findById(id: string): Promise<{ state: { groupId: string; status: string; paidUnits: number; snapshot: { unit: string; wholeQuantityText: string } } } | null> };
  orderBelongsTo: { findByGroupId(groupId: string): Promise<Array<{ state: { userId: string } }>> };
  payments: { findByOrderId(orderId: string): Promise<{ state: { amountFen: number } } | null> };
  refunds: { findByOrderId(orderId: string): Promise<Array<{ state: { status: string; amountFen: number; createdAt: Date } }>> };
}

/** 卡片只读投影（F033）：可见性——商品需上架；订单/组/退款仅本人。 */
@Controller('mini/v1/cards')
export class MiniCardController {
  constructor(@Inject('CARD_PROJECTION_DEPS') private readonly deps: CardProjectionDeps) {}

  private user(request: RequestWithPrincipal): string {
    const userId = request.userAuth?.userId;
    if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    return userId;
  }

  @AuthRealm('user')
  @Get('product/:id')
  async product(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    void this.user(request);
    const product = await this.deps.product.findById(id);
    if (!product || product.state.status !== 'on_shelf') throw new ApplicationError('NOT_FOUND', '商品不存在或未上架');
    return {
      data: { product: { id: product.state.productId, name: product.state.name, unit: product.state.unit, originalPriceFen: product.state.snapshot.originalPriceFen, wholeQuantityText: product.state.snapshot.wholeQuantityText, mainImageId: (product.state.mainImage as { assetId?: string } | null)?.assetId ?? null } },
      requestId: request.requestId
    };
  }

  @AuthRealm('user')
  @Get('order/:id')
  async order(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const userId = this.user(request);
    const order = await this.deps.orders.findById(id);
    if (!order || order.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
    return {
      data: { order: { id: order.state.orderId, orderNo: order.state.orderNo, status: order.state.status, units: order.state.units, totalAmountFen: order.state.totalAmountFen, createdAt: order.state.createdAt.toISOString() } },
      requestId: request.requestId
    };
  }

  @AuthRealm('user')
  @Get('group/:id')
  async group(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const userId = this.user(request);
    const group = await this.deps.groups.findById(id);
    if (!group) throw new ApplicationError('NOT_FOUND', '拼单组不存在');
    const members = await this.deps.orderBelongsTo.findByGroupId(id);
    if (!members.some((m) => m.state.userId === userId)) throw new ApplicationError('NOT_FOUND', '拼单组不存在');
    return {
      data: { group: { id: group.state.groupId, status: group.state.status, paidUnits: group.state.paidUnits, unit: group.state.snapshot.unit, wholeQuantityText: group.state.snapshot.wholeQuantityText } },
      requestId: request.requestId
    };
  }

  @AuthRealm('user')
  @Get('refund/:orderId')
  async refund(@Param('orderId') orderId: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<unknown>> {
    const userId = this.user(request);
    const order = await this.deps.orders.findById(orderId);
    if (!order || order.state.userId !== userId) throw new ApplicationError('NOT_FOUND', '订单不存在');
    const refunds = await this.deps.refunds.findByOrderId(orderId);
    const payment = await this.deps.payments.findByOrderId(orderId);
    return {
      data: { refund: { orderId, paidAmountFen: payment?.state.amountFen ?? 0, items: refunds.map((r) => ({ status: r.state.status, amountFen: r.state.amountFen, createdAt: r.state.createdAt.toISOString() })) } },
      requestId: request.requestId
    };
  }
}
