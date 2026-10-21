import { Module } from '@nestjs/common';
import { EmailController } from './email.controller.js';
import { EmailPreferencesService } from './services/email-preferences.service.js';

@Module({ controllers: [EmailController], providers: [EmailPreferencesService] })
export class EmailModule {}
