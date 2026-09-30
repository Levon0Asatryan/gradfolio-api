import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { b64url, startTestTenant, type TestTenant } from '../../testing/jwks.js';
import {
  type AccessTokenVerifier,
  bearerToken,
  CLAIM_NAMESPACE,
  createAccessTokenVerifier,
  type KeySetTiming,
  type VerifierConfig,
} from './access-token.js';
import { AuthUnavailableError, UnauthenticatedError } from './errors.js';

/**
 * Every case runs through the real verifier against a JWKS served over real
 * HTTP (testing/jwks.ts): each class jose throws, and each way the key source
 * can fail, is produced for real rather than constructed by hand.
 */

let tenant: TestTenant;
beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
afterEach(() => {
  tenant.mode = 'ok';
  vi.useRealTimers();
});

function config(overrides: Partial<VerifierConfig> = {}): VerifierConfig {
  return {
    AUTH0_ISSUER_BASE_URL: tenant.issuer,
    AUTH0_AUDIENCE: tenant.audience,
    AUTH0_JWKS_TIMEOUT_MS: 1000,
    AUTH0_CLOCK_TOLERANCE_S: 5,
    ...overrides,
  };
}

function verifier(overrides: Partial<VerifierConfig> = {}, timing?: KeySetTiming) {
  return createAccessTokenVerifier(config(overrides), timing);
}

/** The reason a token is refused, or `accepted`; anything else is rethrown. */
async function verdict(v: AccessTokenVerifier, token: string): Promise<string> {
  try {
    await v.verify(token);
    return 'accepted';
  } catch (err) {
    if (err instanceof UnauthenticatedError) return err.reason;
    throw err;
  }
}

describe('access token verification', () => {
  it('accepts a valid token and reads the identity from it', async () => {
    const token = await tenant.sign({
      sub: 'google-oauth2|123',
      profile: {
        email: 'ani@example.com',
        email_verified: true,
        name: 'Ani',
        picture: 'https://example.com/a.png',
        identities: ['google-oauth2'],
      },
    });

    await expect(verifier().verify(token)).resolves.toEqual({
      sub: 'google-oauth2|123',
      email: 'ani@example.com',
      emailVerified: true,
      name: 'Ani',
      picture: 'https://example.com/a.png',
      headline: undefined,
      identities: ['google-oauth2'],
    });
  });

  it('treats absent profile claims as unknown and unverified', async () => {
    const identity = await verifier().verify(await tenant.sign({ sub: 'auth0|x' }));
    expect(identity).toEqual({ sub: 'auth0|x', emailVerified: false, identities: [] });
  });

  it('drops a profile claim of the wrong type instead of trusting it', async () => {
    const token = await tenant.sign({
      profile: { email: 42, email_verified: 'yes', identities: 'github' },
    });
    const identity = await verifier().verify(token);
    expect(identity.email).toBeUndefined();
    expect(identity.emailVerified).toBe(false);
    expect(identity.identities).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['one segment', 'abc'],
    ['three junk segments', 'a.b.c'],
    ['a JWE (five segments)', 'a.b.c.d.e'],
  ])('refuses a malformed token: %s', async (_label, token) => {
    expect(await verdict(verifier(), token)).toBe('malformed');
  });

  it('refuses a signature that is not base64url', async () => {
    const [header, payload] = (await tenant.sign()).split('.');
    expect(await verdict(verifier(), `${header}.${payload}.@@@`)).toBe('malformed');
  });

  it('refuses a signed payload that is not a JSON object (JWTInvalid)', async () => {
    const token = await tenant.signRaw({ alg: 'RS256', kid: 'k1' }, 'not json');
    expect(await verdict(verifier(), token)).toBe('malformed');
  });

  it('refuses alg none', async () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: 'auth0|x', iss: tenant.issuer, aud: tenant.audience, exp: 9e9 })}.`;
    expect(await verdict(verifier(), token)).toBe('alg');
  });

  it('refuses HS256 signed with the public key as the secret (algorithm confusion)', async () => {
    const header = b64url({ alg: 'HS256', typ: 'JWT', kid: 'k1' });
    const payload = b64url({ sub: 'auth0|x', iss: tenant.issuer, aud: tenant.audience, exp: 9e9 });
    const sig = createHmac('sha256', await tenant.publicKeyPem())
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(await verdict(verifier(), `${header}.${payload}.${sig}`)).toBe('alg');
  });

  it('refuses RS512', async () => {
    const token = await tenant.signRaw({ alg: 'RS512', kid: 'k1' }, { sub: 'auth0|x' });
    expect(await verdict(verifier(), token)).toBe('alg');
  });

  it('refuses a critical header it does not understand (JOSENotSupported)', async () => {
    const token = await tenant.signRaw(
      { alg: 'RS256', kid: 'k1', crit: ['zzz'], zzz: 1 },
      { sub: 'auth0|x', iss: tenant.issuer, aud: tenant.audience, exp: 9e9 },
    );
    expect(await verdict(verifier(), token)).toBe('unsupported');
  });

  it('refuses another issuer', async () => {
    const token = await tenant.sign({ iss: 'https://evil.auth0.com/' });
    expect(await verdict(verifier(), token)).toBe('claim:iss');
  });

  it('refuses an issuer without the trailing slash (Auth0 writes it; compare is exact)', async () => {
    const token = await tenant.sign({ iss: tenant.issuer.slice(0, -1) });
    expect(await verdict(verifier(), token)).toBe('claim:iss');
  });

  it('refuses another audience, and an ID token (its audience is the client id)', async () => {
    expect(await verdict(verifier(), await tenant.sign({ aud: 'https://other.api' }))).toBe(
      'claim:aud',
    );
    expect(await verdict(verifier(), await tenant.sign({ aud: 'CLIENT_ID_123' }))).toBe(
      'claim:aud',
    );
  });

  it('accepts an audience array that contains ours (API + userinfo, as Auth0 issues)', async () => {
    const token = await tenant.sign({ aud: [tenant.audience, `${tenant.issuer}userinfo`] });
    expect(await verdict(verifier(), token)).toBe('accepted');
  });

  it('refuses an audience array without ours, and a token with no audience', async () => {
    expect(await verdict(verifier(), await tenant.sign({ aud: ['a', 'b'] }))).toBe('claim:aud');
    expect(await verdict(verifier(), await tenant.sign({ aud: null }))).toBe('claim:aud');
  });

  it('refuses an expired token, within the clock tolerance only', async () => {
    expect(await verdict(verifier(), await tenant.sign({ expIn: -60 }))).toBe('expired');
    expect(await verdict(verifier(), await tenant.sign({ expIn: -3 }))).toBe('accepted');
    expect(
      await verdict(verifier({ AUTH0_CLOCK_TOLERANCE_S: 0 }), await tenant.sign({ expIn: -3 })),
    ).toBe('expired');
  });

  it('refuses a token with no expiry: it would otherwise never expire', async () => {
    expect(await verdict(verifier(), await tenant.sign({ expIn: null }))).toBe('claim:exp');
  });

  it('refuses a token not yet valid, within the clock tolerance only', async () => {
    expect(await verdict(verifier(), await tenant.sign({ nbfIn: 60 }))).toBe('claim:nbf');
    expect(await verdict(verifier(), await tenant.sign({ nbfIn: 3 }))).toBe('accepted');
  });

  it('refuses a token with no subject, or one longer than users.auth0_id', async () => {
    expect(await verdict(verifier(), await tenant.sign({ sub: null }))).toBe('claim:sub');
    expect(await verdict(verifier(), await tenant.sign({ sub: `auth0|${'x'.repeat(250)}` }))).toBe(
      'claim:sub',
    );
  });

  it('refuses a key id the tenant does not publish', async () => {
    const token = await tenant.sign({}, { kid: 'nope', key: 'other' });
    expect(await verdict(verifier(), token)).toBe('unknown-key');
  });

  it('refuses a valid signature from a different key under a published key id', async () => {
    const token = await tenant.sign({}, { kid: 'k1', key: 'other' });
    expect(await verdict(verifier(), token)).toBe('signature');
  });

  it('refuses a tampered payload', async () => {
    const [header, , sig] = (await tenant.sign({ sub: 'auth0|alice' })).split('.');
    const forged = b64url({
      sub: 'auth0|mallory',
      iss: tenant.issuer,
      aud: tenant.audience,
      exp: 9e9,
    });
    expect(await verdict(verifier(), `${header}.${forged}.${sig}`)).toBe('signature');
  });

  it('accepts the RFC 9068 token profile (typ at+jwt) as well', async () => {
    const token = await tenant.signRaw(
      { alg: 'RS256', kid: 'k1', typ: 'at+jwt' },
      {
        sub: 'auth0|x',
        iss: tenant.issuer,
        aud: tenant.audience,
        exp: Math.floor(Date.now() / 1000) + 60,
      },
    );
    expect(await verdict(verifier(), token)).toBe('accepted');
  });
});

describe('the key set', () => {
  it('is fetched once for many verifications, concurrent ones included', async () => {
    const before = tenant.fetches;
    const v = verifier();
    const token = await tenant.sign();
    await Promise.all(Array.from({ length: 10 }, () => v.verify(token)));
    for (let i = 0; i < 10; i++) await v.verify(token);
    expect(tenant.fetches - before).toBe(1);
  });

  it('is not refetched for an unknown key id during the cooldown', async () => {
    const v = verifier();
    await v.verify(await tenant.sign());
    const before = tenant.fetches;
    for (let i = 0; i < 5; i++) {
      expect(await verdict(v, await tenant.sign({}, { kid: `x${i}`, key: 'other' }))).toBe(
        'unknown-key',
      );
    }
    expect(tenant.fetches).toBe(before);
  });

  it('picks up a rotated-in key once the cooldown has passed', async () => {
    const v = verifier({}, { cooldownDuration: 0 });
    await v.verify(await tenant.sign());
    const signK2 = await tenant.rotate();
    expect(await verdict(v, await signK2())).toBe('accepted');
  });
});

describe('when the key set cannot be consulted', () => {
  async function outage(v: AccessTokenVerifier, token?: string): Promise<AuthUnavailableError> {
    const err: unknown = await v.verify(token ?? (await tenant.sign())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthUnavailableError);
    return err as AuthUnavailableError;
  }

  it.each([
    ['times out', 'hang', 'JWKSTimeout ERR_JWKS_TIMEOUT'],
    ['answers 500', 'status-500', 'JOSEError ERR_JOSE_GENERIC'],
    ['answers malformed JSON', 'bad-json', 'JOSEError ERR_JOSE_GENERIC'],
    ['answers a malformed key set', 'bad-jwks', 'JWKSInvalid ERR_JWKS_INVALID'],
    ['redirects', 'redirect', 'JOSEError ERR_JOSE_GENERIC'],
  ] as const)('answers 503, not 401, when the JWKS %s', async (_label, mode, source) => {
    tenant.mode = mode;
    const err = await outage(verifier({ AUTH0_JWKS_TIMEOUT_MS: 200 }));
    expect(err.status).toBe(503);
    expect(err.source).toBe(source);
  });

  it('answers 503 when the connection is refused', async () => {
    const v = createAccessTokenVerifier(config({ AUTH0_ISSUER_BASE_URL: 'http://127.0.0.1:1/' }));
    const token = await tenant.sign({ iss: 'http://127.0.0.1:1/' });
    expect((await outage(v, token)).source).toBe('TypeError');
  });

  it('answers 503 when the tenant does not resolve', async () => {
    const issuer = 'https://no-such-tenant.invalid/';
    const v = createAccessTokenVerifier(config({ AUTH0_ISSUER_BASE_URL: issuer }));
    expect((await outage(v, await tenant.sign({ iss: issuer }))).source).toBe('TypeError');
  });

  it('does not use stale keys once the cache has expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const v = verifier({}, { cacheMaxAge: 60_000 });
    const token = await tenant.sign({ expIn: 3600 });
    await v.verify(token);
    tenant.mode = 'status-500';
    vi.setSystemTime(Date.now() + 61_000);
    await outage(v, token);
    tenant.mode = 'ok';
    await expect(v.verify(token)).resolves.toMatchObject({ sub: 'auth0|test-user' });
  });

  it('still refuses a token that never reaches the key set: 401, not 503', async () => {
    tenant.mode = 'status-500';
    const v = verifier();
    expect(await verdict(v, 'abc')).toBe('malformed');
    const hs = `${b64url({ alg: 'HS256', kid: 'k1' })}.${b64url({ sub: 'x' })}.sig`;
    expect(await verdict(v, hs)).toBe('alg');
  });

  it('never quotes the library in what it reports', async () => {
    tenant.mode = 'status-500';
    const err = await outage(verifier());
    expect(err.message).toBe('authentication is temporarily unavailable');
    expect(err.logDetail).not.toMatch(/Expected 200 OK/);
    expect(err.cause).toBeUndefined();
  });
});

describe('rejection errors', () => {
  it('carry the fixed body, the bearer challenge and only our reason for the log', async () => {
    const err: unknown = await verifier()
      .verify(await tenant.sign({ iss: 'https://evil/', profile: { email: 'secret@x.test' } }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthenticatedError);
    const e = err as UnauthenticatedError;
    expect([e.status, e.code, e.message]).toEqual([
      401,
      'UNAUTHENTICATED',
      'authentication required',
    ]);
    expect(e.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
    expect(e.logDetail).toBe('access token rejected: claim:iss');
    expect(JSON.stringify(e)).not.toContain('secret@x.test');
    expect(e.cause).toBeUndefined();
  });
});

describe('bearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['BEARER   abc  ', 'abc'],
  ])('reads %j', (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });

  it.each([undefined, '', 'Bearer', 'Bearer ', 'Basic dXNlcjpwYXNz', 'Bearer a b', 'abc'])(
    'finds no token in %j',
    (header) => {
      expect(bearerToken(header)).toBeUndefined();
    },
  );
});

it('publishes the claim namespace the Auth0 Action writes', () => {
  expect(CLAIM_NAMESPACE).toBe('https://gradfolio.app/');
});
