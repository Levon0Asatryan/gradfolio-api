import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { MeController } from './me.controller.js';
import { AccountService } from './services/account.service.js';
import { OnboardingService } from './services/onboarding.service.js';

@Module({
  imports: [IntegrationsModule],
  controllers: [MeController],
  providers: [OnboardingService, AccountService],
})
export class MeModule {}
