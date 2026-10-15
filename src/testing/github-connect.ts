import { createHash } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { buildApp, captureLogs } from './app.js';
import { testConfig } from './database.js';
import { installFakeAuth0, type FakeAuth0 } from './fake-auth0.js';
import { type FakeRepo, startFakeGithub, type FakeGithub } from './fake-github.js';
import { createUser } from './factories.js';
import { startTestTenant, type TestTenant } from './jwks.js';
import { db } from './team.js';

/**
 * Shared setup for the GitHub connect integration tests (M7): a test tenant
 * with a fake Management API, a fake GitHub, the app configured for both, and
 * students with tokens. Call once per file, at the top level: it registers the
 * file's hooks (one log capture per file, as nestjs-pino requires).
 */

export const SPA_CLIENT_ID = 'gradfolio-spa-client';

export type Http = ReturnType<typeof request>;

export interface Student {
  id: string;
  sub: string;
  auth: { Authorization: string };
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function githubConnectHarness() {
  let tenant: TestTenant;
  let auth0: FakeAuth0;
  let gh: FakeGithub;
  let app: NestExpressApplication | undefined;
  const logs = captureLogs();

  beforeAll(async () => {
    tenant = await startTestTenant();
    auth0 = installFakeAuth0(tenant);
    gh = await startFakeGithub();
  });
  afterAll(async () => {
    await tenant.close();
    await gh.close();
  });
  beforeEach(async () => {
    await db.deleteFrom('users').execute();
    auth0.users.clear();
    auth0.calls.length = 0;
    auth0.tokenStatus = 200;
    delete auth0.identitiesStatus;
    delete auth0.linkStatus;
    auth0.failureHeaders = {};
    gh.tokens.clear();
    gh.revoked.length = 0;
    gh.requests.length = 0;
    gh.userMode = 'ok';
    gh.grantStatus = undefined;
    gh.grantHang = false;
    gh.grantDropAfterProcessing = false;
    gh.repos.clear();
    gh.repoMode = 'ok';
  });
  afterEach(async () => {
    logs.clear();
    await app?.close();
    app = undefined;
  });

  const env = (): NodeJS.ProcessEnv => ({
    AUTH0_CLIENT_ID: SPA_CLIENT_ID,
    AUTH0_M2M_CLIENT_ID: auth0.clientId,
    AUTH0_M2M_CLIENT_SECRET: auth0.clientSecret,
    GITHUB_CLIENT_ID: gh.clientId,
    GITHUB_CLIENT_SECRET: gh.clientSecret,
    GITHUB_API_BASE_URL: gh.baseUrl,
    AUTH0_MANAGEMENT_SPACING_MS: '0',
    // A link's Auth0 step may take 4 s in all; a reservation is stale after 6 s.
    AUTH0_MANAGEMENT_TIMEOUT_MS: '2000',
  });

  return {
    get tenant() {
      return tenant;
    },
    get auth0() {
      return auth0;
    },
    get gh() {
      return gh;
    },
    logs,
    env,

    /** The app, configured for GitHub connect unless `env` says otherwise. */
    async start(over: NodeJS.ProcessEnv = env()): Promise<Http> {
      app = await buildApp(
        testConfig({
          LOG_LEVEL: 'info',
          AUTH0_ISSUER_BASE_URL: tenant.issuer,
          AUTH0_AUDIENCE: tenant.audience,
          ...over,
        }),
        undefined,
        { logs },
      );
      return request(app.getHttpServer());
    },

    /** A user row, known to Auth0, and an access token; `emailVerified` false unless given. */
    async student(
      sub: string,
      {
        emailVerified = false,
        identities,
      }: { emailVerified?: boolean; identities?: string[] } = {},
    ): Promise<Student> {
      const user = await createUser(db, { auth0Id: sub, name: sub });
      auth0.withUser(sub);
      const token = await tenant.sign({
        sub,
        profile: { email_verified: emailVerified, ...(identities ? { identities } : {}) },
      });
      return { id: user.id, sub, auth: { Authorization: `Bearer ${token}` } };
    },

    /** Auth0 holds a GitHub identity for `sub`, and GitHub knows its token. */
    linkedAtAuth0(sub: string, githubId: string, login: string): void {
      auth0.withGithub(sub, githubId);
      gh.tokens.set(auth0.githubTokenFor(githubId), { id: Number(githubId), login });
    },

    /** A repository GitHub knows (public, default branch `main`, a short README), owned by `ownerId`. */
    addRepo(over: Partial<FakeRepo> & { id: number; ownerId: number }): FakeRepo {
      const repo: FakeRepo = {
        name: `repo-${over.id}`,
        ownerLogin: `owner-${over.ownerId}`,
        description: `Repo ${over.id}`,
        language: 'TypeScript',
        stars: 3,
        forks: 1,
        private: false,
        fork: false,
        archived: false,
        defaultBranch: 'main',
        pushedAt: new Date(Date.UTC(2026, 0, 1) + over.id * 60_000).toISOString(),
        pushers: [],
        readme: `<h1>Repo ${over.id}</h1><p>Hello.</p>`,
        readmePath: 'README.md',
        ...over,
      };
      gh.repos.set(repo.id, repo);
      return repo;
    },

    /** A GitHub-connected student: user row, Auth0 identity, GitHub token, and `connect` done. */
    async connectedStudent(
      http: Http,
      githubId: string,
      login = `login-${githubId}`,
    ): Promise<Student> {
      const sub = `github|${githubId}`;
      const s = await this.student(sub);
      this.linkedAtAuth0(sub, githubId, login);
      await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
      return s;
    },

    /** GitHub knows the token Auth0 will hold for `githubId` after a link. */
    githubKnows(githubId: string, login: string): void {
      gh.tokens.set(auth0.githubTokenFor(githubId), { id: Number(githubId), login });
    },

    /** The id token of a secondary GitHub sign-in carrying `nonce`. */
    idToken(githubId: string, nonce: string, extra: Record<string, unknown> = {}): Promise<string> {
      return tenant.sign({
        sub: `github|${githubId}`,
        aud: SPA_CLIENT_ID,
        extra: { nonce, ...extra },
      });
    },

    async nonceFor(http: Http, s: Student): Promise<string> {
      const res = await http.post('/v1/me/integrations/github/connect').set(s.auth).expect(200);
      const body = res.body as { state: string; nonce: string };
      expect(body.state).toBe('link_required');
      return body.nonce;
    },
  };
}

export const githubRow = (userId: string) =>
  db
    .selectFrom('integrations')
    .selectAll()
    .where('userId', '=', userId)
    .where('integrationType', '=', 'github')
    .executeTakeFirst();

export const verifiedOf = async (userId: string) =>
  (await db.selectFrom('users').select('verified').where('id', '=', userId).executeTakeFirst())
    ?.verified;

/** Ages a reservation past the stale threshold, as if its link were long over. */
export const ageReservation = (userId: string, seconds = 3600) =>
  db
    .updateTable('integrations')
    .set({ updatedAt: new Date(Date.now() - seconds * 1000) })
    .where('userId', '=', userId)
    .execute();
