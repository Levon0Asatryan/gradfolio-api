import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationService } from './services/notification.service.js';

@Module({ controllers: [NotificationsController], providers: [NotificationService] })
export class NotificationsModule {}
