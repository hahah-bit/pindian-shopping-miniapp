import { Controller, Get, Post, HttpCode, Inject, Param, Body, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApplicationError } from '../../../../../shared/kernel';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';
import { ShipFulfillmentUseCase, UpdateReceiverUseCase, CompleteFulfillmentUseCase } from '../../../application/admin-fulfillment';
import { AdminFulfillmentQueries } from '../../../application/admin-fulfillment-queries';

const WEIGHT_KIND: Readonly<Record<string, number>> = { '斤': 1, '千克': 1, 'kg': 1, '克': 1, 'g': 1, '两': 1 };

export interface AdminFulfillmentQueriesPort {
  listGroups(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: unknown[]; total: number }>;
  groupDetail(groupId: string, options?: { unmasked?: boolean }): Promise<{ groupId: string; items: unknown[] } | null>;
  groupExportRows(groupId: string): Promise<Array<Record<string, unknown>> | null>;
}

/** 后台履约管理（order:manage）：列表/明细/发货/补发/改址/完成/导出。 */
@Controller('admin/v1/fulfillment')
export class AdminFulfillmentController {
  constructor(
    @Inject('ADMIN_FULFILLMENT_QUERIES') private readonly queries: AdminFulfillmentQueriesPort,
    @Inject('FULFILLMENT_AUDIT') private readonly audit: { execute(entry: { adminId: string | null; action: string; resourceType: string; resourceId: string; requestId: string | null; detail?: Record<string, unknown> }): Promise<void> },
    @Inject(ShipFulfillmentUseCase) private readonly ship: ShipFulfillmentUseCase,
    @Inject(UpdateReceiverUseCase) private readonly receiver: UpdateReceiverUseCase,
    @Inject(CompleteFulfillmentUseCase) private readonly complete: CompleteFulfillmentUseCase
  ) {}

  private admin(request: RequestWithPrincipal): { adminId: string | null; requestId: string | null } {
    return { adminId: request.adminAuth?.adminId ?? null, requestId: request.requestId };
  }

  @Get('groups')
  @RequirePermissions('order:manage')
  async groups(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<unknown> {
    const result = await this.queries.listGroups({ status: query.status ?? null, page: Math.max(1, Number(query.page ?? 1)), pageSize: Math.min(50, Number(query.pageSize ?? 10)) });
    return { data: result, requestId: request.requestId };
  }

  @Get('groups/:id/shipments/export')
  @RequirePermissions('order:manage')
  async exportCsv(@Param('id') id: string, @Req() request: RequestWithPrincipal, @Res() response: Response): Promise<void> {
    const rows = await this.queries.groupExportRows(id);
    if (!rows) throw new ApplicationError('NOT_FOUND', '拼单组不存在或未进入履约');
    // 导出含收货明文：必须写审计（F029）；审计失败必须阻断导出（2026-10-02 复验 P2——不得无留痕导出）
    try {
      await this.audit.execute({ adminId: request.adminAuth?.adminId ?? null, action: 'fulfillment.export', resourceType: 'fulfillment_group', resourceId: id, requestId: request.requestId, detail: { rows: rows.length } });
    } catch (error) {
      console.error('[fulfillment-export] 导出审计失败，阻断明文导出', id, error instanceof Error ? error.message : error);
      throw new ApplicationError('EXPORT_AUDIT_FAILED', '导出审计不可用，已阻断明文导出，请稍后重试');
    }
    const header = ['履约单号', '订单号', '用户', '分配数量(克)', '收货人', '电话', '省', '市', '区', '详址', '状态', '快递公司', '运单号', '包裹数量(克)', '补发', '发货时间'];
    const escape = (value: unknown) => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [header.join(',')];
    for (const row of rows) {
      const shipments = (row.shipments as Array<{ company: string; trackingNo: string; quantityGrams: number; isReissue: boolean; shippedAt: string }>) ?? [];
      const base = [row.fulfillmentOrderId, row.orderNo, row.nickname, row.allocatedQuantityGrams, row.receiverName, row.receiverPhone, row.province, row.city, row.district, row.detail, row.status];
      if (shipments.length === 0) {
        lines.push([...base, '', '', '', '', ''].map(escape).join(','));
      } else {
        for (const shipment of shipments) {
          lines.push([...base, shipment.company, shipment.trackingNo, shipment.quantityGrams, shipment.isReissue ? '是' : '否', shipment.shippedAt].map(escape).join(','));
        }
      }
    }
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="shipments-${id}.csv"`);
    response.send('\uFEFF' + lines.join('\r\n'));
    void request;
  }

  @Get('groups/:id')
  @RequirePermissions('order:manage')
  async groupDetail(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<unknown> {
    const result = await this.queries.groupDetail(id);
    if (!result) throw new ApplicationError('NOT_FOUND', '拼单组不存在或未进入履约');
    return { data: result, requestId: request.requestId };
  }

  @Post('orders/:id/shipments')
  @HttpCode(201)
  @RequirePermissions('order:manage')
  async shipShipment(@Param('id') id: string, @Body() body: { quantityGrams?: unknown; company?: unknown; trackingNo?: unknown; isReissue?: boolean; reason?: unknown }, @Req() request: RequestWithPrincipal): Promise<unknown> {
    const { adminId, requestId } = this.admin(request);
    const result = await this.ship.execute({
      fulfillmentId: id,
      quantityGrams: body?.quantityGrams,
      company: body?.company,
      trackingNo: body?.trackingNo,
      isReissue: Boolean(body?.isReissue),
      reason: body?.reason,
      adminId,
      requestId
    });
    return { data: { shipmentId: result.shipmentId, fulfillmentOrder: { id: result.fulfillmentOrder.state.fulfillmentOrderId, status: result.fulfillmentOrder.state.status, shippedQuantityGrams: result.fulfillmentOrder.state.shippedQuantityGrams, unit: result.fulfillmentOrder.state.unit, quantityType: result.fulfillmentOrder.state.unit in WEIGHT_KIND ? 'weight' : 'countable' } }, requestId: request.requestId };
  }

  @Post('orders/:id/receiver')
  @RequirePermissions('order:manage')
  async updateReceiver(@Param('id') id: string, @Body() body: { receiverName?: unknown; phone?: unknown; province?: unknown; city?: unknown; district?: unknown; detail?: unknown }, @Req() request: RequestWithPrincipal): Promise<unknown> {
    const { adminId, requestId } = this.admin(request);
    const result = await this.receiver.execute({
      fulfillmentId: id,
      receiver: { name: body?.receiverName, phone: body?.phone, province: body?.province, city: body?.city, district: body?.district, detail: body?.detail },
      adminId,
      requestId
    });
    return { data: { fulfillmentOrder: { id: result.fulfillmentOrder.state.fulfillmentOrderId, receiverVersion: result.fulfillmentOrder.state.receiver.version } }, requestId: request.requestId };
  }

  @Post('orders/:id/complete')
  @HttpCode(200)
  @RequirePermissions('order:manage')
  async completeOrder(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<unknown> {
    const { adminId, requestId } = this.admin(request);
    const result = await this.complete.execute({ fulfillmentId: id, by: 'admin', adminId, requestId });
    return { data: { fulfillmentOrder: { id: result.fulfillmentOrder.state.fulfillmentOrderId, status: result.fulfillmentOrder.state.status, completedBy: result.fulfillmentOrder.state.completedBy } }, requestId: request.requestId };
  }
}
