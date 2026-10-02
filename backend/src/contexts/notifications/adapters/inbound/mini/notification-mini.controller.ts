import { Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ApiResponse, MiniNotificationList, NotificationRecordView } from '@pindian/contracts';
import { ApplicationError } from '../../../../../shared/kernel';
import type { RequestWithPrincipal } from '../../../../identity-access/adapters/inbound/admin/access.guard';
import { AuthRealm } from '../../../../identity-access/adapters/inbound/admin/route-access';
import type { NotificationRepository } from '../../../application/ports';

function toView(notification: { state: { notificationId: string | null; eventType: string; title: string; body: string; reference: Record<string, unknown>; readAt: Date | null; createdAt: Date | null } }): NotificationRecordView {
  const s = notification.state;
  return {
    id: s.notificationId as string,
    eventType: s.eventType,
    title: s.title,
    body: s.body,
    reference: s.reference,
    readAt: s.readAt ? s.readAt.toISOString() : null,
    createdAt: s.createdAt ? s.createdAt.toISOString() : new Date(0).toISOString()
  };
}

/** 小程序消息中心（T009/F040，D023）：仅本人通知，已读幂等。 */
@Controller('mini/v1/notifications')
@AuthRealm('user')
export class NotificationMiniController {
  constructor(@Inject('NOTIFICATION_REPOSITORY') private readonly repository: NotificationRepository) {}

  @Get()
  async list(@Query() query: Record<string, string | undefined>, @Req() request: RequestWithPrincipal): Promise<ApiResponse<MiniNotificationList>> {
    const userId = requireUser(request);
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize ?? 10)));
    const result = await this.repository.listUserNotifications(userId, page, pageSize);
    return {
      data: {
        items: result.items.map(toView),
        page,
        pageSize,
        total: result.total,
        unreadCount: result.unreadCount
      },
      requestId: request.requestId
    };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @Req() request: RequestWithPrincipal): Promise<ApiResponse<{ notification: NotificationRecordView }>> {
    const userId = requireUser(request);
    const found = await this.repository.findUserNotification(id, userId);
    if (!found) throw new ApplicationError('NOT_FOUND', '通知不存在');
    found.markRead(userId, new Date());
    await this.repository.markRead(id, userId, found.state.readAt as Date);
    return { data: { notification: toView(found) }, requestId: request.requestId };
  }
}

function requireUser(request: RequestWithPrincipal): string {
  const userId = request.userAuth?.userId;
  if (!userId) throw new ApplicationError('UNAUTHENTICATED', '请先登录');
  return userId;
}
