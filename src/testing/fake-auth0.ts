import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TestTenant } from './jwks.js';

/**
 * A stand-in for Auth0's Management API and its token endpoint, served by the
 * test tenant under its issuer (as Auth0 serves them under the tenant domain),
 * over real HTTP: the client's queue, timeouts, headers and error mapping run
 * against a real transport, never a mocked fetch (docs/m7-plan.md §10).
 *
 * Its shapes follow Auth0's documentation (`POST /oauth/token`, `GET
 * /api/v2/users/{id}`, `POST /api/v2/users/{id}/identities`); they are not
 * recordings of the real tenant (the spike, plan §2.1, has not run).
 */

export interface FakeIdentity {
  provider: string;
  user_id: string | number;
  connection: string;
  isSocial: boolean;
  access_token?: string;
}

export interface RecordedCall {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
  at: number;
}

/** Holds the next link request until released. */
export interface Gate {
  /** Resolves when the held request has arrived. */
  arrived: Promise<void>;
  release(): void;
}

export interface FakeAuth0 {
  readonly clientId: string;
  readonly clientSecret: string;
  /** The M2M access token it issues: a sentinel no response or log may contain. */
  readonly m2mToken: string;
  /** sub -> identities. A sub absent here is a 404. */
  readonly users: Map<string, FakeIdentity[]>;
  readonly calls: RecordedCall[];
  /** The GitHub token Auth0 "holds" for a GitHub user id after a link or login. */
  githubTokenFor: (githubUserId: string) => string;
  tokenStatus: number;
  tokenExpiresIn: number;
  /** Answer GET identities with this status instead (and these headers). */
  identitiesStatus?: number;
  /** Answer the link with this status instead (and these headers); nothing is linked. */
  linkStatus?: number;
  failureHeaders: Record<string, string>;
  /** Adds a user (when new) with a GitHub identity holding `githubTokenFor(id)`. */
  withGithub(sub: string, githubUserId: string): void;
  /** Adds a user with only their primary identity. */
  withUser(sub: string): void;
  holdNextLink(): Gate;
  /** Calls to a path starting with this (`/api/v2/`, `/oauth/token`). */
  callsTo(prefix: string): RecordedCall[];
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : undefined);
      } catch {
        resolve(text);
      }
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers = {}): void {
  if (res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** The provider and id of a primary sub (`auth0|x` -> `auth0`, `x`). */
function primaryIdentity(sub: string): FakeIdentity {
  const [provider = 'auth0', ...rest] = sub.split('|');
  return {
    provider,
    user_id: rest.join('|'),
    connection: provider === 'auth0' ? 'Username-Password-Authentication' : provider,
    isSocial: provider !== 'auth0',
  };
}

function githubIdentity(id: string, token: string): FakeIdentity {
  return {
    provider: 'github',
    user_id: Number(id),
    connection: 'github',
    isSocial: true,
    access_token: token,
  };
}

/** The `sub` of an unverified JWT (the fake does not check what Auth0 would). */
function subOf(jwt: unknown): string | undefined {
  if (typeof jwt !== 'string') return undefined;
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as {
      sub?: unknown;
    };
    return typeof payload.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

export function installFakeAuth0(tenant: TestTenant): FakeAuth0 {
  let gate: { arrived: () => void; released: Promise<void> } | undefined;

  const fake: FakeAuth0 = {
    clientId: 'm2m-client-id',
    clientSecret: 'm2m-SENTINEL-client-secret',
    m2mToken: 'm2m-SENTINEL-access-token',
    users: new Map(),
    calls: [],
    githubTokenFor: (id) => `gho_SENTINEL_${id}`,
    tokenStatus: 200,
    tokenExpiresIn: 86_400,
    failureHeaders: {},
    withUser(sub) {
      if (!this.users.has(sub)) this.users.set(sub, [primaryIdentity(sub)]);
    },
    withGithub(sub, githubUserId) {
      this.withUser(sub);
      const list = this.users.get(sub)!;
      const token = this.githubTokenFor(githubUserId);
      const existing = list.findIndex((i) => i.provider === 'github');
      if (existing >= 0) list[existing] = githubIdentity(githubUserId, token);
      else list.push(githubIdentity(githubUserId, token));
    },
    holdNextLink() {
      let arrived!: () => void;
      let release!: () => void;
      const arrivedP = new Promise<void>((r) => (arrived = r));
      const released = new Promise<void>((r) => (release = r));
      gate = { arrived, released };
      return { arrived: arrivedP, release };
    },
    callsTo(prefix) {
      return this.calls.filter((c) => c.path.startsWith(prefix));
    },
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const body = await readBody(req);
    fake.calls.push({
      method: req.method ?? '',
      path: url.pathname,
      authorization: req.headers.authorization,
      body,
      at: Date.now(),
    });

    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      const b = body as Record<string, unknown> | undefined;
      const valid =
        b?.grant_type === 'client_credentials' &&
        b.client_id === fake.clientId &&
        b.client_secret === fake.clientSecret &&
        b.audience === `${tenant.issuer}api/v2/`;
      if (!valid) return json(res, 401, { error: 'access_denied' });
      if (fake.tokenStatus !== 200) return json(res, fake.tokenStatus, { error: 'boom' });
      return json(res, 200, {
        access_token: fake.m2mToken,
        expires_in: fake.tokenExpiresIn,
        token_type: 'Bearer',
      });
    }

    if (req.headers.authorization !== `Bearer ${fake.m2mToken}`) {
      return json(res, 401, { statusCode: 401, error: 'Unauthorized' });
    }

    const identities = /^\/api\/v2\/users\/([^/]+)\/identities$/.exec(url.pathname);
    if (identities && req.method === 'POST') {
      if (gate) {
        const held = gate;
        gate = undefined;
        held.arrived();
        await held.released;
      }
      if (fake.linkStatus !== undefined) {
        return json(res, fake.linkStatus, { statusCode: fake.linkStatus }, fake.failureHeaders);
      }
      const primary = decodeURIComponent(identities[1]!);
      const secondary = subOf((body as { link_with?: unknown } | undefined)?.link_with);
      if (!fake.users.has(primary) || secondary === undefined) return json(res, 400, {});
      const id = secondary.split('|')[1] ?? '';
      fake.withGithub(primary, id);
      return json(res, 201, fake.users.get(primary));
    }

    const user = /^\/api\/v2\/users\/([^/]+)$/.exec(url.pathname);
    if (user && req.method === 'GET') {
      if (fake.identitiesStatus !== undefined) {
        return json(
          res,
          fake.identitiesStatus,
          { statusCode: fake.identitiesStatus },
          fake.failureHeaders,
        );
      }
      const list = fake.users.get(decodeURIComponent(user[1]!));
      if (!list) return json(res, 404, { statusCode: 404, error: 'Not Found' });
      return json(res, 200, { identities: list });
    }

    return json(res, 404, {});
  };

  tenant.addRoute((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path !== '/oauth/token' && !path.startsWith('/api/v2/')) return false;
    void handle(req, res);
    return true;
  });
  return fake;
}
