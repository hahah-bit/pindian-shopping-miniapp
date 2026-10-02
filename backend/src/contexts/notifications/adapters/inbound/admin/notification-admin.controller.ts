import { Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiResponse, AdminDeliveryListItem, DeliveryStatus } from '@pindian/contracts';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { RequirePermissions } from '../../../../identity-access/adapters/inbound/admin/route-access';
import type { NotificationRepository } from '../../../application/ports';
import { RetryDelivery } from '../../../application/retry-delivery';

type DeliveryRow = Awaited<ReturnType<NotificationRepository['listDeliveries']>>['items'][number];

function toListItem(row: DeliveryRow): AdminDeliveryListItem {
  const d = row.delivery;
  const n = row.notification.state;
  return {
    id: d.deliveryId as string,
    notificationId: d.notificationId as string,
    eventType: n.eventType,
    title: n.title,
    recipientType: row.recipientType,
    recipientName: row.recipientName,
    channel: d.channel,
    status: d.status as DeliveryStatus,
    attemptCount: d.attemptCount,
    maxAttempts: d.maxAttempts,
    lastError: d.lastError,
    nextAttemptAt: d.nextAttemptAt ? d.nextAttemptAt.toISOString() : null,
    sentAt: d.sentAt ? d.sentAt.toISOString() : null,
    skippedReason: d.skippedReason,
    createdAt: n.createdAt ? n.createdAt.toISOString() : (d.updatedAt ?? new Date(0)).toISOString()
  };
}

/** 通知投递查询与手工重试（T009/F038，notification:manage）。 */
@Controller('admin/v1/notifications')
export class NotificationAdminController {
  constructor(
    @Inject('NOTIFICATION_REPOSITORY') private readonly repository: NotificationRepository,
    @Inject(RetryDelivery) private readonly retryDelivery: RetryDelivery
  ) {}

  @Get('deliveries')
  @RequirePermissions('notification:manage')
  async deliveries(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ items: AdminDeliveryListItem[]; page: number; pageSize: number; total: number }>> {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? 10)));
    const result = await this.repository.listDeliveries({
      status: query.status ?? null,
      channel: query.channel ?? null,
      eventType: query.eventType ?? null,
      page,
      pageSize
    });
    return { data: { items: result.items.map(toListItem), page, pageSize, total: result.total }, requestId: request.requestId };
  }

  /** 手工重试：仅 failed；重置为待投递并写审计（DELIVERY_NOT_RETRYABLE→409）。 */
  @Post('deliveries/:id/retry')
  @HttpCode(200)
  @RequirePermissions('notification:manage')
  async retry(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ delivery: AdminDeliveryListItem }>> {
    await this.retryDelivery.execute({
      deliveryId: id,
      adminId: request.adminAuth?.adminId ?? null,
      requestId: request.requestId
    });
    const found = await this.repository.findDeliveryById(id);
    const notification = found?.notification;
    if (!found || !notification) throw new Error('重试后投递不可见');
    return {
      data: {
        delivery: toListItem({
          delivery: found.delivery,
          notification,
          recipientType: notification.state.recipientAdminId ? 'admin' : 'user',
          recipientName: '（当前管理员）'
        })
      },
      requestId: request.requestId
    };
  }
}
