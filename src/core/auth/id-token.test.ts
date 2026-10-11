import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { b64url, startTestTenant, type TestTenant, type TokenClaims } from '../../testing/jwks.js';
import { AuthUnavailableError, InvalidIdTokenError } from './errors.js';
import { createIdTokenVerifier, type IdTokenSettings } from './id-token.js';

/**
 * The link id token (docs/m7-plan.md §2.3 step 1, §10 "Link id token"): every
 * refusal produced for real against a JWKS over HTTP, with the reason each
 * maps to, so removing an option shows up as a different verdict.
 */
const CLIENT_ID = 'gradfolio-spa-client';
let tenant: TestTenant;
beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());

const settings = (over: Partial<IdTokenSettings> = {}): IdTokenSettings => ({
  issuer: tenant.issuer,
  clientId: CLIENT_ID,
  jwksTimeoutMs: 1000,
  clockToleranceS: 5,
  maxAgeS: 300,
  ...over,
});
const idToken = (claims: TokenClaims = {}) =>
  tenant.sign({
    sub: 'github|583231',
    aud: CLIENT_ID,
    ...claims,
    extra: { nonce: 'n-123', ...claims.extra },
  });

async function verdict(token: string, over: Partial<IdTokenSettings> = {}): Promise<string> {
  try {
    await createIdTokenVerifier(settings(over)).verify(token);
    return 'accepted';
  } catch (err) {
    if (err instanceof InvalidIdTokenError) return err.reason;
    throw err;
  }
}

describe('link id token verification', () => {
  it('accepts a fresh GitHub sign-in for this application, and reads the GitHub id and nonce', async () => {
    expect(await createIdTokenVerifier(settings()).verify(await idToken())).toEqual({
      sub: 'github|583231',
      githubUserId: '583231',
      nonce: 'n-123',
    });
  });

  it.each<[string, () => Promise<string>, string]>([
    [
      'alg none',
      () =>
        Promise.resolve(
          `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: 'github|1', iss: tenant.issuer, aud: CLIENT_ID, exp: 9e9, iat: Math.floor(Date.now() / 1000), nonce: 'n' })}.`,
        ),
      'alg',
    ],
    [
      'HS256 signed with the public key',
      async () => {
        const input = `${b64url({ alg: 'HS256', typ: 'JWT', kid: 'k1' })}.${b64url({ sub: 'github|1', iss: tenant.issuer, aud: CLIENT_ID, exp: 9e9, iat: Math.floor(Date.now() / 1000), nonce: 'n' })}`;
        const sig = createHmac('sha256', await tenant.publicKeyPem())
          .update(input)
          .digest('base64url');
        return `${input}.${sig}`;
      },
      'alg',
    ],
    [
      'another key under the same kid',
      () =>
        tenant.sign({ sub: 'github|1', aud: CLIENT_ID, extra: { nonce: 'n' } }, { key: 'other' }),
      'signature',
    ],
    ['the wrong issuer', () => idToken({ iss: 'https://evil.example/' }), 'claim:iss'],
    ['the access token audience', () => idToken({ aud: tenant.audience }), 'claim:aud'],
    ['no audience', () => idToken({ aud: null }), 'claim:aud'],
    ['expired', () => idToken({ expIn: -60 }), 'expired'],
    ['no exp', () => idToken({ expIn: null }), 'claim:exp'],
    ['issued 6 minutes ago', () => idToken({ iatIn: -360 }), 'expired'],
    ['no iat', () => idToken({ iatIn: null }), 'claim:iat'],
    ['issued in the future', () => idToken({ iatIn: 120 }), 'claim:iat'],
    ['a database user', () => idToken({ sub: 'auth0|x' }), 'not-github'],
    ['a GitHub sub that is not a number', () => idToken({ sub: 'github|abc' }), 'not-github'],
    ['no nonce', () => tenant.sign({ sub: 'github|1', aud: CLIENT_ID }), 'claim:nonce'],
    ['a nonce that is not a string', () => idToken({ extra: { nonce: 42 } }), 'nonce'],
    ['a nonce far longer than ours', () => idToken({ extra: { nonce: 'n'.repeat(201) } }), 'nonce'],
  ])('refuses %s', async (_case, make, reason) => {
    expect(await verdict(await make())).toBe(reason);
  });

  it('applies the configured maximum age', async () => {
    const token = await idToken({ iatIn: -100 });
    expect(await verdict(token)).toBe('accepted');
    expect(await verdict(token, { maxAgeS: 60 })).toBe('expired');
  });

  it('answers 503 when the signing keys cannot be fetched, never a verdict on the token', async () => {
    const token = await idToken();
    tenant.mode = 'status-500';
    try {
      const fresh = createIdTokenVerifier(settings());
      await expect(fresh.verify(token)).rejects.toBeInstanceOf(AuthUnavailableError);
    } finally {
      tenant.mode = 'ok';
    }
  });

  it('never puts the token or a claim in its error', async () => {
    const token = await idToken({ iss: 'https://evil.example/' });
    const err = await createIdTokenVerifier(settings())
      .verify(token)
      .then(
        () => {
          throw new Error('accepted');
        },
        (e: unknown) => e as InvalidIdTokenError,
      );
    expect(err.status).toBe(400);
    expect(err.code).toBe('INVALID_ID_TOKEN');
    expect(JSON.stringify({ ...err, message: err.message, log: err.logDetail })).not.toMatch(
      /evil|583231|n-123/,
    );
  });
});
