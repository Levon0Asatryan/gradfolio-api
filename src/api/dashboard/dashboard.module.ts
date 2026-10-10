import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './services/dashboard.service.js';

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
