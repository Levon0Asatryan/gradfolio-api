import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, exportSPKI, generateKeyPair, type JWK, SignJWT } from 'jose';
import { CLAIM_NAMESPACE } from '../core/auth/access-token.js';

/**
 * A stand-in Auth0 tenant for tests: serves a JWKS over real HTTP on
 * 127.0.0.1 and signs tokens with its keys, so the verifier's fetch, cache and
 * error paths run through real transport rather than a mocked fetch.
 */

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

/** How the JWKS endpoint answers. */
export type JwksMode = 'ok' | 'hang' | 'status-500' | 'bad-json' | 'bad-jwks' | 'redirect';

export interface TokenClaims {
  sub?: string | null;
  iss?: string | null;
  aud?: string | string[] | null;
  /** Seconds from now; null omits the claim. */
  expIn?: number | null;
  nbfIn?: number;
  /** Profile claims, written under the namespace. */
  profile?: Record<string, unknown>;
  /** Anything else, unnamespaced. */
  extra?: Record<string, unknown>;
}

export interface TestTenant {
  /** `http://127.0.0.1:<port>/`, the issuer to configure. */
  issuer: string;
  audience: string;
  /** How many times the JWKS was requested. */
  readonly fetches: number;
  mode: JwksMode;
  /** A token signed by the published key `kid`. */
  sign(claims?: TokenClaims, opts?: { kid?: string; key?: 'published' | 'other' }): Promise<string>;
  /**
   * Signs an arbitrary header and payload with the published key, bypassing
   * jose's signer, which refuses some of the tokens tests need (an unknown
   * `crit`, a payload that is not a JSON object).
   */
  signRaw(header: Record<string, unknown>, payload: unknown): Promise<string>;
  /** The published key as PEM: the "secret" of an HS256 algorithm-confusion forgery. */
  publicKeyPem(): Promise<string>;
  /** Publishes a second key (`k2`) and returns a signer for it. */
  rotate(): Promise<(claims?: TokenClaims) => Promise<string>>;
  close(): Promise<void>;
}

export const TEST_TENANT_AUDIENCE = 'https://api.gradfolio.test';

async function publicJwk(pair: KeyPair, kid: string): Promise<JWK> {
  return { ...(await exportJWK(pair.publicKey)), kid, alg: 'RS256', use: 'sig' };
}

export async function startTestTenant(audience = TEST_TENANT_AUDIENCE): Promise<TestTenant> {
  const k1 = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  const keys: JWK[] = [await publicJwk(k1, 'k1')];
  let fetches = 0;
  const hanging = new Set<import('node:http').ServerResponse>();

  const state = { mode: 'ok' as JwksMode };
  const server: Server = createServer((_req, res) => {
    fetches++;
    switch (state.mode) {
      case 'hang':
        hanging.add(res);
        return;
      case 'status-500':
        res.writeHead(500).end('boom');
        return;
      case 'bad-json':
        res.writeHead(200, { 'content-type': 'application/json' }).end('{');
        return;
      case 'bad-jwks':
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"nope":1}');
        return;
      case 'redirect':
        res.writeHead(302, { location: 'http://127.0.0.1:1/' }).end();
        return;
      default:
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${port}/`;

  const signer =
    (pair: KeyPair, kid: string | undefined) =>
    async (claims: TokenClaims = {}): Promise<string> => {
      const now = Math.floor(Date.now() / 1000);
      const {
        sub = 'auth0|test-user',
        iss = issuer,
        aud = audience,
        expIn = 600,
        nbfIn,
        profile = {},
        extra = {},
      } = claims;
      const payload: Record<string, unknown> = { ...extra };
      for (const [name, value] of Object.entries(profile)) {
        payload[`${CLAIM_NAMESPACE}${name}`] = value;
      }
      if (sub !== null) payload.sub = sub;
      if (iss !== null) payload.iss = iss;
      if (aud !== null) payload.aud = aud;
      if (expIn !== null) payload.exp = now + expIn;
      if (nbfIn !== undefined) payload.nbf = now + nbfIn;
      return new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(kid ? { kid } : {}) })
        .setIssuedAt()
        .sign(pair.privateKey);
    };

  return {
    issuer,
    audience,
    get fetches() {
      return fetches;
    },
    get mode() {
      return state.mode;
    },
    set mode(m: JwksMode) {
      state.mode = m;
    },
    sign(claims, { kid = 'k1', key = 'published' } = {}) {
      return signer(key === 'published' ? k1 : other, kid)(claims);
    },
    async signRaw(header, payload) {
      const input = `${b64url(header)}.${b64url(payload)}`;
      const sig = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        k1.privateKey,
        new TextEncoder().encode(input),
      );
      return `${input}.${Buffer.from(sig).toString('base64url')}`;
    },
    publicKeyPem() {
      return exportSPKI(k1.publicKey);
    },
    async rotate() {
      const k2 = await generateKeyPair('RS256', { extractable: true });
      keys.push(await publicJwk(k2, 'k2'));
      return signer(k2, 'k2');
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Base64url JSON, for hand-built tokens (`alg: none`, HS256 forgeries). */
export function b64url(value: unknown): string {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString(
    'base64url',
  );
}
