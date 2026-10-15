import { Module } from '@nestjs/common';
import { createIdTokenVerifier } from '../../core/auth/id-token.js';
import { Auth0ManagementClient } from '../../core/auth0/management-client.js';
import { APP_CONFIG } from '../../core/config/config.module.js';
import { type AppConfig, githubIntegrationSettings } from '../../core/config/schema.js';
import { GithubClient } from '../../core/github/github-client.js';
import { Auth0IdpTokenSource } from '../../core/github/token-source.js';
import { GITHUB_CONNECT, type GithubConnect } from './integrations.constants.js';
import { IntegrationsController } from './integrations.controller.js';
import { GithubConnectionService } from './services/github-connection.service.js';

/** GitHub connect's clients, or null when any of its five credentials is unset (D9). */
export function createGithubConnect(cfg: AppConfig): GithubConnect | null {
  const settings = githubIntegrationSettings(cfg);
  if (settings === undefined) return null;
  const management = new Auth0ManagementClient({
    issuer: cfg.AUTH0_ISSUER_BASE_URL,
    clientId: settings.m2mClientId,
    clientSecret: settings.m2mClientSecret,
    timeoutMs: cfg.AUTH0_MANAGEMENT_TIMEOUT_MS,
    spacingMs: cfg.AUTH0_MANAGEMENT_SPACING_MS,
  });
  return {
    settings,
    management,
    tokens: new Auth0IdpTokenSource(management, {
      ttlMs: cfg.GITHUB_TOKEN_CACHE_S * 1000,
      maxEntries: cfg.GITHUB_TOKEN_CACHE_MAX,
    }),
    github: new GithubClient({
      baseUrl: cfg.GITHUB_API_BASE_URL,
      timeoutMs: cfg.GITHUB_TIMEOUT_MS,
    }),
    idTokens: createIdTokenVerifier({
      issuer: cfg.AUTH0_ISSUER_BASE_URL,
      clientId: settings.auth0ClientId,
      jwksTimeoutMs: cfg.AUTH0_JWKS_TIMEOUT_MS,
      clockToleranceS: cfg.AUTH0_CLOCK_TOLERANCE_S,
      maxAgeS: cfg.LINK_ID_TOKEN_MAX_AGE_S,
    }),
    linkDeadlineMs: 2 * cfg.AUTH0_MANAGEMENT_TIMEOUT_MS,
    revokeDeadlineMs: 2 * cfg.AUTH0_MANAGEMENT_TIMEOUT_MS + cfg.GITHUB_TIMEOUT_MS,
  };
}

@Module({
  controllers: [IntegrationsController],
  providers: [
    GithubConnectionService,
    { provide: GITHUB_CONNECT, inject: [APP_CONFIG], useFactory: createGithubConnect },
  ],
  exports: [GithubConnectionService],
})
export class IntegrationsModule {}
