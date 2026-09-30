import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ApiResponse, MiniOrderView } from '@pindian/contracts';
import { CancelUnpaidOrder, PlaceOrderWorkflow } from '../../../../../workflows/order-place.workflow';
import type { OrderRepository } from '../../../application/order-ports';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm } from '../../../../identity-access/adapters/inbound/admin/route-access';

function iso(value: Date): string {
  return value.toISOString();
}

@Controller('mini/v1/orders')
export class MiniOrdersController {
  constructor(
    @Inject(PlaceOrderWorkflow) private readonly placeOrder: PlaceOrderWorkflow,
    @Inject(CancelUnpaidOrder) private readonly cancelOrder: CancelUnpaidOrder,
    @Inject('ORDER_REPOSITORY') private readonly orders: OrderRepository,
  ) {}

  private userId(request: RequestWithPrincipal): string {
    const userId = request.userAuth?.userId;
    if (!userId) throw new UnauthorizedException('访问凭证无效或已过期');
    return userId;
  }

  @Post()
  async place(@Body() body: { productId?: unknown; units?: unknown; addressId?: unknown; idempotencyKey?: unknown }, @Req() request: RequestWithPrincipal): Promise<ApiResponse<MiniOrderView>> {
    const userId = this.userId(request);
    const result = await this.placeOrder.execute({
      userId,
      command: { productId: body?.productId, units: body?.units, addressId: body?.addressId, idempotencyKey: body?.idempotencyKey ?? randomUUID() }
    });
    const full = await this.orders.findById(result.orderId);
    if (!full) throw new UnauthorizedException('订单查询失败');
    return { data: this.toView(full), requestId: request.requestId };
  }

  @AuthRealm('user')
  @Get()
  async list(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: MiniOrderView[]; page: number; pageSize: number; total: number }>> {
    const userId = this.userId(request);
    const page = query.page === undefined ? 1 : Math.max(1, Number(query.page) || 1);
    const pageSize = query.pageSize === undefined ? 10 : Math.min(50, Math.max(1, Number(query.pageSize) || 10));
    const result = await this.orders.listByUser(userId, page, pageSize);
    return {
      data: {
        items: result.items.map((order) => this.toView(order)),
        page,
        pageSize,
        total: result.total
      },
      requestId: request.requestId
    };
  }

  @AuthRealm('user')
  @Get(':id')
  async get(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<MiniOrderView>> {
    const userId = this.userId(request);
    const order = await this.orders.findById(id);
    if (!order || order.state.userId !== userId) throw new UnauthorizedException('订单不存在');
    return { data: this.toView(order), requestId: request.requestId };
  }

  @AuthRealm('user')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ cancelled: true }>> {
    return { data: await this.cancelOrder.execute({ userId: this.userId(request), orderId: id }), requestId: request.requestId };
  }

  private toView(order: NonNullable<Awaited<ReturnType<OrderRepository['findById']>>>): MiniOrderView {
    const s = order.state;
    return {
      id: s.orderId,
      orderNo: s.orderNo,
      status: s.status,
      units: s.units,
      productId: s.productId,
      groupId: s.groupId,
      quote: {
        totalAmountFen: s.totalAmountFen,
        goodsAmountFen: s.goodsAmountFen,
        serviceFeeFen: s.serviceFeeFen,
        tailAdjustFen: s.tailAdjustFen,
        isFinalOrder: s.isFinalOrder
      },
      productSnapshot: {
        originalPriceFen: s.originalPriceFen,
        unit: s.unit,
        wholeQuantityText: s.wholeQuantityText,
        referenceQuantityText: s.referenceQuantityText
      },
      addressSnapshot: {
        receiverName: s.addressReceiverName,
        phone: s.addressPhone,
        province: s.addressProvince,
        city: s.addressCity,
        district: s.addressDistrict,
        detail: s.addressDetail
      },
      groupSummary: null,
      reservationExpiresAt: iso(s.reservationExpiresAt),
      paymentNotice: '微信支付暂未开放，开放后可支付该订单',
      createdAt: iso(s.createdAt)
    };
  }
}
