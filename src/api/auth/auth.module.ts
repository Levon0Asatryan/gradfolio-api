import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../core/config/config.module.js';
import type { AppConfig } from '../../core/config/schema.js';
import {
  type AccessTokenVerifier,
  createAccessTokenVerifier,
} from '../../core/auth/access-token.js';
import { ACCESS_TOKEN_VERIFIER } from './auth.constants.js';

@Module({
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig): AccessTokenVerifier => createAccessTokenVerifier(cfg),
    },
  ],
  exports: [ACCESS_TOKEN_VERIFIER],
})
export class AuthModule {}
