import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installFakeAuth0, type FakeAuth0 } from '../../testing/fake-auth0.js';
import { startTestTenant, type TestTenant } from '../../testing/jwks.js';
import { IntegrationUnavailableError } from './errors.js';
import { Auth0ManagementClient, type ManagementSettings } from './management-client.js';

/**
 * The Management API client against a fake tenant over real HTTP
 * (docs/m7-plan.md §2.2): the M2M token, the queue, and each answer class.
 */
describe('Auth0ManagementClient', () => {
  let tenant: TestTenant;
  let fake: FakeAuth0;

  beforeAll(async () => {
    tenant = await startTestTenant();
    fake = installFakeAuth0(tenant);
  });
  afterAll(() => tenant.close());
  beforeEach(() => {
    fake.calls.length = 0;
    fake.users.clear();
    fake.tokenStatus = 200;
    fake.tokenExpiresIn = 86_400;
    delete fake.identitiesStatus;
    delete fake.linkStatus;
    fake.failureHeaders = {};
  });

  const client = (over: Partial<ManagementSettings> = {}, now?: () => number) =>
    new Auth0ManagementClient(
      {
        issuer: tenant.issuer,
        clientId: fake.clientId,
        clientSecret: fake.clientSecret,
        timeoutMs: 1000,
        spacingMs: 0,
        ...over,
      },
      now,
    );
  const unavailable = (p: Promise<unknown>) =>
    p.then(
      () => undefined,
      (e: unknown) => (e instanceof IntegrationUnavailableError ? e : e),
    );

  it('reads identities with the M2M token, which it fetches once and reuses', async () => {
    fake.withGithub('auth0|ani', '583231');
    const c = client();
    const [first] = await Promise.all([c.identities('auth0|ani'), c.identities('auth0|ani')]);
    await c.identities('auth0|ani');

    expect(fake.callsTo('/oauth/token')).toHaveLength(1);
    const reads = fake.callsTo('/api/v2/users/');
    expect(reads).toHaveLength(3);
    expect(reads[0]!.authorization).toBe(`Bearer ${fake.m2mToken}`);
    expect(first?.map((i) => [i.provider, i.userId, i.isSocial])).toEqual([
      ['auth0', 'ani', false],
      ['github', '583231', true],
    ]);
    expect(first?.[1]?.accessToken?.reveal()).toBe(fake.githubTokenFor('583231'));
    expect(JSON.stringify(first)).not.toContain('gho_');
  });

  it('asks only for identities, and encodes the sub into the path', async () => {
    fake.withUser('auth0|a/b');
    await client().identities('auth0|a/b');
    const url = fake.callsTo('/api/v2/users/')[0]!;
    expect(url.path).toBe('/api/v2/users/auth0%7Ca%2Fb');
  });

  it('answers null for a user Auth0 does not have', async () => {
    expect(await client().identities('auth0|nobody')).toBeNull();
  });

  it('renews the M2M token 60 s before it expires', async () => {
    let now = 1_000_000;
    fake.tokenExpiresIn = 120;
    fake.withUser('auth0|x');
    const c = client({}, () => now);
    await c.identities('auth0|x');
    now += 59_000;
    await c.identities('auth0|x');
    expect(fake.callsTo('/oauth/token')).toHaveLength(1);
    now += 2_000;
    await c.identities('auth0|x');
    expect(fake.callsTo('/oauth/token')).toHaveLength(2);
  });

  it('a refused M2M token is 503, and so are 401, 403, 5xx and a bad body from the API', async () => {
    fake.tokenStatus = 500;
    expect(await unavailable(client().identities('auth0|x'))).toBeInstanceOf(
      IntegrationUnavailableError,
    );
    fake.tokenStatus = 200;
    for (const status of [401, 403, 500, 418]) {
      fake.identitiesStatus = status;
      const err = await unavailable(client().identities('auth0|x'));
      expect(err, String(status)).toBeInstanceOf(IntegrationUnavailableError);
      expect((err as IntegrationUnavailableError).status).toBe(503);
    }
  });

  it('drops its M2M token after a 401, so the next call fetches a new one', async () => {
    fake.withUser('auth0|x');
    const c = client();
    await c.identities('auth0|x');
    fake.identitiesStatus = 401;
    await unavailable(c.identities('auth0|x'));
    delete fake.identitiesStatus;
    await c.identities('auth0|x');
    expect(fake.callsTo('/oauth/token')).toHaveLength(2);
  });

  it('a 429 is 503 with Retry-After, and holds the queue until then', async () => {
    fake.identitiesStatus = 429;
    fake.failureHeaders = { 'retry-after': '1' };
    const c = client({ timeoutMs: 5000 });
    const err = (await unavailable(c.identities('auth0|x'))) as IntegrationUnavailableError;
    expect(err.headers).toEqual({ 'Retry-After': '1' });
    const refusedAt = performance.now();

    delete fake.identitiesStatus;
    fake.withUser('auth0|x');
    await c.identities('auth0|x');
    // Timer granularity: a little under the second is still the second.
    expect(performance.now() - refusedAt).toBeGreaterThanOrEqual(950);
  });

  it('a 429 without a usable header still pauses for a second', async () => {
    fake.identitiesStatus = 429;
    const err = (await unavailable(client().identities('auth0|x'))) as IntegrationUnavailableError;
    expect(err.headers).toEqual({ 'Retry-After': '1' });
  });

  it('times out a hung call as 503', async () => {
    const t = await startTestTenant();
    const f = installFakeAuth0(t);
    f.withUser('auth0|x');
    const gate = f.holdNextLink();
    const c = new Auth0ManagementClient({
      issuer: t.issuer,
      clientId: f.clientId,
      clientSecret: f.clientSecret,
      timeoutMs: 200,
      spacingMs: 0,
    });
    const result = await c.linkIdentity('auth0|x', 'header.e30.sig');
    expect(result.outcome).toBe('unknown');
    gate.release();
    await t.close();
  });

  describe('linkIdentity', () => {
    const idToken = (sub: string) =>
      `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;

    it('links, sending the id token as link_with', async () => {
      fake.withUser('auth0|ani');
      expect(await client().linkIdentity('auth0|ani', idToken('github|7'))).toEqual({
        outcome: 'linked',
      });
      const call = fake.callsTo('/api/v2/users/')[0]!;
      expect(call.path).toBe('/api/v2/users/auth0%7Cani/identities');
      expect(call.body).toEqual({ link_with: idToken('github|7') });
      expect(fake.users.get('auth0|ani')?.map((i) => i.provider)).toEqual(['auth0', 'github']);
    });

    it('a 4xx about the request is a refusal; 401, 403 and 429 were never processed', async () => {
      for (const status of [400, 404, 409]) {
        fake.linkStatus = status;
        expect(await client().linkIdentity('auth0|ani', idToken('github|7'))).toEqual({
          outcome: 'refused',
          status,
        });
      }
      for (const status of [401, 403, 429]) {
        fake.linkStatus = status;
        const r = await client().linkIdentity('auth0|ani', idToken('github|7'));
        expect(r.outcome, String(status)).toBe('not_attempted');
      }
    });

    it('a 5xx leaves the outcome unknown; a failed M2M token means nothing was sent', async () => {
      fake.linkStatus = 503;
      expect((await client().linkIdentity('auth0|ani', idToken('github|7'))).outcome).toBe(
        'unknown',
      );
      fake.tokenStatus = 500;
      const r = await client().linkIdentity('auth0|ani', idToken('github|7'));
      expect(r.outcome).toBe('not_attempted');
      expect(fake.callsTo('/api/v2/')).toHaveLength(1);
    });

    it('an already-aborted caller sends nothing', async () => {
      const ctl = new AbortController();
      ctl.abort(new DOMException('gone', 'AbortError'));
      const r = await client().linkIdentity('auth0|ani', idToken('github|7'), ctl.signal);
      expect(r.outcome).toBe('not_attempted');
      expect(fake.callsTo('/api/v2/')).toHaveLength(0);
    });
  });
});
