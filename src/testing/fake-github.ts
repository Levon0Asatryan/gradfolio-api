import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for GitHub's REST API over real HTTP on 127.0.0.1, with GitHub's
 * own status codes and header names (`x-ratelimit-remaining`,
 * `x-ratelimit-reset`, `retry-after`). It records every request, so a test can
 * assert which paths the API fetched and with which credentials.
 */

export interface GithubRecord {
  method: string;
  path: string;
  authorization: string | undefined;
  apiVersion: string | undefined;
  userAgent: string | undefined;
  ifNoneMatch: string | undefined;
  body: unknown;
}

/** How `GET /user` answers, whatever the token. */
export type UserMode =
  | 'ok'
  | 'rate-limited'
  | 'secondary-limit'
  | 'status-500'
  | 'status-418'
  | 'hang'
  | 'redirect'
  | 'huge'
  | 'bad-json';

/** A repository GitHub knows, as the fake serves it. */
export interface FakeRepo {
  id: number;
  name: string;
  ownerId: number;
  ownerLogin: string;
  description: string | null;
  language: string | null;
  /** Topics the repository lists. */
  topics?: string[];
  /** `GET /repos/{o}/{r}/languages`: language -> bytes. Absent: only `language`. */
  languages?: Record<string, number>;
  stars: number;
  forks: number;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  pushedAt: string;
  /** Collaborators (token user ids) who may push although they do not own it. */
  pushers: number[];
  /** GitHub-rendered README HTML; null: the repository has none. */
  readme: string | null;
  readmePath: string;
}

export type RepoMode = 'ok' | 'rate-limited' | 'status-500';

export interface FakeGithub {
  /** `http://127.0.0.1:<port>/`. */
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Live tokens -> the user they belong to. A token not here answers 401. */
  readonly tokens: Map<string, { id: number; login: string }>;
  readonly revoked: string[];
  readonly requests: GithubRecord[];
  userMode: UserMode;
  /** Answer every grant delete with this status instead (nothing is revoked). */
  grantStatus?: number;
  /** Never answer a grant delete. */
  grantHang: boolean;
  /** Process every grant delete (the token is revoked), then drop the connection unanswered. */
  grantDropAfterProcessing: boolean;
  /** `x-ratelimit-reset` it sends, epoch seconds. */
  resetAt: number;
  /** Public profile fields per GitHub user id (`bio`, `location`, `company`, `avatar_url`, `blog`, `html_url`). */
  readonly profiles: Map<number, Record<string, string | null>>;
  /** `GET /user/social_accounts` per GitHub user id. */
  readonly socialAccounts: Map<number, { provider: string; url: string }[]>;
  /** Repositories by id; `GET /user/repos`, `/repositories/{id}` and its README read them. */
  readonly repos: Map<number, FakeRepo>;
  /** How the repository routes answer, whatever the token. */
  repoMode: RepoMode;
  /** Holds the next `GET /repositories/{id}` answer, decided at arrival, until released. */
  holdNextRepo(): { arrived: Promise<void>; release(): void };
  /** The same for the next `GET /repositories/{id}/readme`. */
  holdNextReadme(): { arrived: Promise<void>; release(): void };
  /**
   * Holds the next `GET /user` answer, decided when the request arrived (as
   * GitHub answered then), until released: the answer is in flight while the
   * test changes the world.
   */
  holdNextUser(): { arrived: Promise<void>; release(): void };
  /** The same for the next grant delete: the grant is gone, the 204 is in flight. */
  holdNextGrant(): { arrived: Promise<void>; release(): void };
  /**
   * Holds the next grant delete **before** it is processed: the request has
   * arrived, the token is still valid at GitHub, and revokes only on release.
   */
  holdNextGrantRequest(): { arrived: Promise<void>; release(): void };
  close(): Promise<void>;
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

export async function startFakeGithub(): Promise<FakeGithub> {
  const hanging = new Set<ServerResponse>();
  let userGate: { arrived: () => void; released: Promise<void> } | undefined;
  let grantGate: { arrived: () => void; released: Promise<void> } | undefined;
  let grantRequestGate: { arrived: () => void; released: Promise<void> } | undefined;
  let repoGate: { arrived: () => void; released: Promise<void> } | undefined;
  let readmeGate: { arrived: () => void; released: Promise<void> } | undefined;
  const gate = () => {
    let arrived!: () => void;
    let release!: () => void;
    const arrivedP = new Promise<void>((r) => (arrived = r));
    const released = new Promise<void>((r) => (release = r));
    return { held: { arrived, released }, handle: { arrived: arrivedP, release } };
  };
  const state = {
    tokens: new Map<string, { id: number; login: string }>(),
    revoked: [] as string[],
    requests: [] as GithubRecord[],
    userMode: 'ok' as UserMode,
    grantStatus: undefined as number | undefined,
    grantHang: false,
    grantDropAfterProcessing: false,
    resetAt: Math.floor(Date.now() / 1000) + 120,
    repos: new Map<number, FakeRepo>(),
    profiles: new Map<number, Record<string, string | null>>(),
    socialAccounts: new Map<number, { provider: string; url: string }[]>(),
    repoMode: 'ok' as RepoMode,
  };
  const clientId = 'gh-oauth-client';
  const clientSecret = 'gh-SENTINEL-client-secret';

  const send = (res: ServerResponse, status: number, body?: unknown, headers = {}) => {
    res.writeHead(status, {
      ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-reset': String(state.resetAt),
      ...headers,
    });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://fake').pathname;
      const body = await readBody(req);
      state.requests.push({
        method: req.method ?? '',
        path,
        authorization: req.headers.authorization,
        apiVersion: req.headers['x-github-api-version'] as string | undefined,
        userAgent: req.headers['user-agent'],
        ifNoneMatch: req.headers['if-none-match'],
        body,
      });

      if (path === '/user' && req.method === 'GET') {
        switch (state.userMode) {
          case 'rate-limited':
            return send(
              res,
              403,
              { message: 'API rate limit exceeded' },
              {
                'x-ratelimit-remaining': '0',
              },
            );
          case 'secondary-limit':
            return send(res, 429, { message: 'secondary rate limit' }, { 'retry-after': '37' });
          case 'status-500':
            return send(res, 500, { message: 'boom' });
          case 'status-418':
            return send(res, 418, { message: 'teapot' });
          case 'hang':
            hanging.add(res);
            return;
          case 'redirect':
            res.writeHead(302, { location: 'http://127.0.0.1:9/elsewhere' }).end();
            return;
          case 'huge':
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(`{"id":1,"login":"x","pad":"${'a'.repeat(2 * 1024 * 1024)}"}`);
            return;
          case 'bad-json':
            res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":');
            return;
          default: {
            const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
            const user = token === undefined ? undefined : state.tokens.get(token);
            if (userGate) {
              const held = userGate;
              userGate = undefined;
              held.arrived();
              await held.released;
            }
            if (!user) return send(res, 401, { message: 'Bad credentials' });
            const profile = state.profiles.get(user.id) ?? {};
            const etag = `W/"${createHash('sha1')
              .update(JSON.stringify([user, profile]))
              .digest('hex')}"`;
            if (req.headers['if-none-match'] === etag) {
              res.writeHead(304, {
                etag,
                'x-ratelimit-limit': '5000',
                'x-ratelimit-remaining': '4999',
                'x-ratelimit-reset': String(state.resetAt),
              });
              res.end();
              return;
            }
            return send(
              res,
              200,
              { ...user, type: 'User', site_admin: false, email: null, ...profile },
              { etag },
            );
          }
        }
      }

      const asUser = () => {
        const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
        return token === undefined ? undefined : state.tokens.get(token);
      };
      const repoJson = (r: FakeRepo, me: { id: number }) => ({
        id: r.id,
        name: r.name,
        full_name: `${r.ownerLogin}/${r.name}`,
        description: r.description,
        language: r.language,
        topics: r.topics ?? [],
        stargazers_count: r.stars,
        forks_count: r.forks,
        html_url: `https://github.com/${r.ownerLogin}/${r.name}`,
        private: r.private,
        fork: r.fork,
        archived: r.archived,
        default_branch: r.defaultBranch,
        pushed_at: r.pushedAt,
        owner: { id: r.ownerId, login: r.ownerLogin },
        permissions: { push: r.ownerId === me.id || r.pushers.includes(me.id) },
      });
      const visibleTo = (r: FakeRepo, me: { id: number }) =>
        !r.private || r.ownerId === me.id || r.pushers.includes(me.id);
      const repoFailure = () => {
        if (state.repoMode === 'rate-limited') {
          return send(
            res,
            403,
            { message: 'API rate limit exceeded' },
            { 'x-ratelimit-remaining': '0' },
          );
        }
        if (state.repoMode === 'status-500') return send(res, 500, { message: 'boom' });
        return undefined;
      };

      if (path === '/user/repos' && req.method === 'GET') {
        const me = asUser();
        if (!me) return send(res, 401, { message: 'Bad credentials' });
        if (state.repoMode !== 'ok') return repoFailure();
        const q = new URL(req.url ?? '/', 'http://fake').searchParams;
        const perPage = Math.min(100, Math.max(1, Number(q.get('per_page') ?? 30)));
        const page = Math.max(1, Number(q.get('page') ?? 1));
        const mine = [...state.repos.values()]
          .filter((r) => (r.ownerId === me.id || r.pushers.includes(me.id)) && !r.private)
          .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt) || a.id - b.id);
        const slice = mine.slice((page - 1) * perPage, page * perPage);
        const more = page * perPage < mine.length;
        return send(
          res,
          200,
          slice.map((r) => repoJson(r, me)),
          more
            ? { link: `<http://fake/user/repos?page=${page + 1}&per_page=${perPage}>; rel="next"` }
            : {},
        );
      }

      if (path === '/user/social_accounts' && req.method === 'GET') {
        const me = asUser();
        if (!me) return send(res, 401, { message: 'Bad credentials' });
        return send(res, 200, state.socialAccounts.get(me.id) ?? []);
      }

      const langPath = /^\/repos\/([^/]+)\/([^/]+)\/languages$/.exec(path);
      if (langPath && req.method === 'GET') {
        const me = asUser();
        if (!me) return send(res, 401, { message: 'Bad credentials' });
        if (state.repoMode !== 'ok') return repoFailure();
        const repo = [...state.repos.values()].find(
          (r) => r.ownerLogin === langPath[1] && r.name === langPath[2],
        );
        if (repo === undefined || !visibleTo(repo, me)) {
          return send(res, 404, { message: 'Not Found' });
        }
        return send(res, 200, repo.languages ?? (repo.language ? { [repo.language]: 1000 } : {}));
      }

      const repoPath = /^\/repositories\/(\d+)(\/readme)?$/.exec(path);
      if (repoPath && req.method === 'GET') {
        const me = asUser();
        if (!me) return send(res, 401, { message: 'Bad credentials' });
        if (repoGate && !repoPath[2]) {
          const held = repoGate;
          repoGate = undefined;
          held.arrived();
          await held.released;
        }
        if (readmeGate && repoPath[2]) {
          const held = readmeGate;
          readmeGate = undefined;
          held.arrived();
          await held.released;
        }
        if (state.repoMode !== 'ok') return repoFailure();
        const repo = state.repos.get(Number(repoPath[1]));
        if (repo === undefined || !visibleTo(repo, me)) {
          return send(res, 404, { message: 'Not Found' });
        }
        if (!repoPath[2]) return send(res, 200, repoJson(repo, me));
        if (repo.readme === null) return send(res, 404, { message: 'Not Found' });
        res.writeHead(200, {
          'content-type': 'application/vnd.github.html+json; charset=utf-8',
          'x-ratelimit-remaining': '4990',
          'x-ratelimit-reset': String(state.resetAt),
        });
        res.end(
          `<div id="readme" class="" data-path="${repo.readmePath}"><article>${repo.readme}</article></div>`,
        );
        return;
      }

      const grant = /^\/applications\/([^/]+)\/grant$/.exec(path);
      if (grant && req.method === 'DELETE') {
        if (state.grantHang) {
          hanging.add(res);
          return;
        }
        if (grantRequestGate) {
          const held = grantRequestGate;
          grantRequestGate = undefined;
          held.arrived();
          await held.released;
        }
        const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
        if (decodeURIComponent(grant[1]!) !== clientId || req.headers.authorization !== basic) {
          return send(res, 401, { message: 'Requires authentication' });
        }
        if (state.grantStatus !== undefined) return send(res, state.grantStatus, { message: 'x' });
        const token = (body as { access_token?: unknown } | undefined)?.access_token;
        if (typeof token !== 'string' || !state.tokens.has(token)) {
          return send(res, 422, { message: 'Validation Failed' });
        }
        state.tokens.delete(token);
        state.revoked.push(token);
        if (state.grantDropAfterProcessing) {
          req.socket.destroy();
          return;
        }
        if (grantGate) {
          const held = grantGate;
          grantGate = undefined;
          held.arrived();
          await held.released;
        }
        return send(res, 204);
      }

      return send(res, 404, { message: 'Not Found' });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    clientId,
    clientSecret,
    get tokens() {
      return state.tokens;
    },
    get revoked() {
      return state.revoked;
    },
    get requests() {
      return state.requests;
    },
    get userMode() {
      return state.userMode;
    },
    set userMode(m: UserMode) {
      state.userMode = m;
    },
    get grantStatus() {
      return state.grantStatus;
    },
    set grantStatus(s: number | undefined) {
      state.grantStatus = s;
    },
    repos: state.repos,
    profiles: state.profiles,
    socialAccounts: state.socialAccounts,
    get repoMode() {
      return state.repoMode;
    },
    set repoMode(m: RepoMode) {
      state.repoMode = m;
    },
    holdNextRepo() {
      const g = gate();
      repoGate = g.held;
      return g.handle;
    },
    holdNextReadme() {
      const g = gate();
      readmeGate = g.held;
      return g.handle;
    },
    get grantDropAfterProcessing() {
      return state.grantDropAfterProcessing;
    },
    set grantDropAfterProcessing(d: boolean) {
      state.grantDropAfterProcessing = d;
    },
    get grantHang() {
      return state.grantHang;
    },
    set grantHang(h: boolean) {
      state.grantHang = h;
    },
    get resetAt() {
      return state.resetAt;
    },
    set resetAt(t: number) {
      state.resetAt = t;
    },
    holdNextUser() {
      const g = gate();
      userGate = g.held;
      return g.handle;
    },
    holdNextGrant() {
      const g = gate();
      grantGate = g.held;
      return g.handle;
    },
    holdNextGrantRequest() {
      const g = gate();
      grantRequestGate = g.held;
      return g.handle;
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
