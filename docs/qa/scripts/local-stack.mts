import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { startTestTenant } from '../../../src/testing/jwks.ts';
import { requireQaDatabase } from './qa-database.mjs';

// Isolated QA only: real API/MySQL and SDK session cookies, with the existing
// test issuer standing in for Auth0. Never point this at a deployed database.
const frontendRoot = process.env.QA_FRONTEND_ROOT ?? '/qa/gradfolio';
const stateDir = process.env.QA_STATE_DIR ?? '/qa/state';
const baseURL = 'http://localhost:3100';
const secret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
requireQaDatabase(process.env.DATABASE_URL, process.env.DATABASE_SOCKET_PATH);
await mkdir(stateDir, { recursive: true });
const tenant = await startTestTenant();
const requireFrontend = createRequire(`${frontendRoot}/package.json`);
const { generateSessionCookie } = await import(
  pathToFileURL(requireFrontend.resolve('@auth0/nextjs-auth0/testing')).href
);
const env = {
  ...process.env,
  NODE_ENV: 'development',
  API_PORT: '3001',
  LOG_LEVEL: 'warn',
  AUTH0_ISSUER_BASE_URL: tenant.issuer,
  AUTH0_AUDIENCE: tenant.audience,
  // Keep functional browser matrices separate from the default-limit checks.
  RATE_LIMIT_DEFAULT: '10000',
  RATE_LIMIT_SEARCH: '10000',
};
execFileSync(process.execPath, ['dist/core/db/migrator/cli.js', 'up'], { env, stdio: 'inherit' });
execFileSync(process.execPath, ['dist/core/db/seed/cli.js'], { env, stdio: 'inherit' });
const apiLog = createWriteStream(`${stateDir}/api.log`);
const api = spawn(process.execPath, ['dist/api/main.js'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
api.stdout.pipe(apiLog);
api.stderr.pipe(apiLog);
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch('http://localhost:3001/readyz')).ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  api.kill();
  await tenant.close();
  throw new Error('QA API did not become ready; inspect state/api.log');
}

const tokens: Record<string, string> = {};
for (const [label, sub, name] of [
  ['a', 'seed|anahit-sargsyan', 'Անահիտ Սարգսյան'],
  ['b', 'seed|dmitri-volkov', 'Дмитрий Волков'],
  ['c', 'auth0|qa-disposable-c', 'QA Disposable C'],
  ['d', 'auth0|qa-concurrent-d', 'QA Concurrent D'],
] as const) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await tenant.sign({
    sub,
    expIn: 43200,
    profile: { name, email: `${label}@qa.example.test`, email_verified: true },
  });
  tokens[label] = accessToken;
  const value = await generateSessionCookie(
    {
      user: { sub, name, email: `${label}@qa.example.test` },
      tokenSet: { accessToken, expiresAt: now + 43200 },
      internal: { sid: `qa-${label}`, createdAt: now },
    },
    { secret },
  );
  await writeFile(
    `${stateDir}/${label}.json`,
    JSON.stringify({
      cookies: [
        {
          name: '__session',
          value,
          domain: 'localhost',
          path: '/',
          expires: now + 43200,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
}
tokens.expired = await tenant.sign({ sub: 'auth0|qa-expired', expIn: -60 });
await writeFile(`${stateDir}/tokens.json`, JSON.stringify(tokens), { mode: 0o600 });
await writeFile(
  `${stateDir}/issuer.json`,
  JSON.stringify({ issuer: tenant.issuer, audience: tenant.audience }),
);

const frontLog = createWriteStream(`${stateDir}/frontend.log`);
const frontend = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-p', '3100'],
  {
    cwd: frontendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      AUTH0_DOMAIN: 'e2e.example.auth0.com',
      AUTH0_CLIENT_ID: 'e2e-client',
      AUTH0_CLIENT_SECRET: 'e2e-secret',
      AUTH0_SECRET: secret,
      APP_BASE_URL: baseURL,
      API_BASE_URL: 'http://localhost:3001',
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: '--no-experimental-require-module',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
frontend.stdout.pipe(frontLog);
frontend.stderr.pipe(frontLog);
console.log('QA API ready; frontend starting on 3100. Sessions remain inside QA state directory.');
const close = async () => {
  frontend.kill();
  api.kill();
  await tenant.close();
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
