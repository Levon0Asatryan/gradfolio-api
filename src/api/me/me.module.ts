import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { OnboardingService } from './services/onboarding.service.js';

@Module({ controllers: [MeController], providers: [OnboardingService] })
export class MeModule {}
