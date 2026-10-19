import type { Auth0Management } from '../../core/auth0/management-client.js';
import type { IdTokenVerifier } from '../../core/auth/id-token.js';
import type { GithubIntegrationSettings } from '../../core/config/index.js';
import type { GithubClient } from '../../core/github/github-client.js';
import type { GithubTokenSource } from '../../core/github/token-source.js';

/** Injection token for GithubConnect, or null when GitHub connect is not configured. */
export const GITHUB_CONNECT = Symbol('GITHUB_CONNECT');

/** Everything GitHub connect talks to; one of each per process (they own caches and a queue). */
export interface GithubConnect {
  settings: GithubIntegrationSettings;
  management: Auth0Management;
  tokens: GithubTokenSource;
  github: GithubClient;
  idTokens: IdTokenVerifier;
  /**
   * How long a link's Auth0 step may take in all (M2M token, queue, request):
   * twice the Management API timeout. A reservation older than this (plus a
   * margin) cannot have a call still in flight (docs/modules/m7/plan.md §2.3).
   */
  linkDeadlineMs: number;
  /**
   * How long a revocation may take in all: the token read from Auth0 (the link
   * deadline's allowance) and GitHub's grant delete (its own timeout). A
   * revocation marker older than this (plus a margin) has no call in flight.
   */
  revokeDeadlineMs: number;
}
