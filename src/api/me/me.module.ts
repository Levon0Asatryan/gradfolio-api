import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { AccountService } from './services/account.service.js';
import { OnboardingService } from './services/onboarding.service.js';

@Module({ controllers: [MeController], providers: [OnboardingService, AccountService] })
export class MeModule {}
