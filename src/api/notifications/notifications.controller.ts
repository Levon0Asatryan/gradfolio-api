import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { zodQuery } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../users/decorators/current-user.decorator.js';
import type { UserRow } from '../users/repositories/user.repository.js';
import {
  type NotificationPage,
  type NotificationQuery,
  notificationQuerySchema,
} from './dto/notification.dto.js';
import { NotificationService } from './services/notification.service.js';

/** The caller's own notifications. Every route is scoped to them: another user's id is 404. */
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(
    @CurrentUser() user: UserRow,
    @Query(zodQuery(notificationQuerySchema)) query: NotificationQuery,
  ): Promise<NotificationPage> {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: UserRow): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: UserRow): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(user.id) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }
}
