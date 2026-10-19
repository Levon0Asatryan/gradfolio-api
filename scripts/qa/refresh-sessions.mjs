import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const stateDir = process.env.QA_STATE_DIR ?? '/qa/state';
const root = process.env.QA_FRONTEND_ROOT ?? '/qa/gradfolio';
const req = createRequire(`${root}/package.json`);
const { generateSessionCookie } = await import(
  pathToFileURL(req.resolve('@auth0/nextjs-auth0/testing')).href
);
const tokens = JSON.parse(await readFile(`${stateDir}/tokens.json`, 'utf8'));
for (const [label, sub, name] of [
  ['a', 'seed|anahit-sargsyan', 'Անահիտ Սարգսյան'],
  ['b', 'seed|dmitri-volkov', 'Дмитрий Волков'],
  ['c', 'auth0|qa-disposable-c', 'QA Disposable C'],
]) {
  const now = Math.floor(Date.now() / 1000);
  const value = await generateSessionCookie(
    {
      user: { sub, name },
      tokenSet: { accessToken: tokens[label], expiresAt: now + 3600 },
      internal: { sid: `qa-${label}`, createdAt: now },
    },
    { secret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
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
          expires: now + 3600,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
}
console.log(
  'Local SDK test session cookies refreshed (the SDK helper expires them after one hour).',
);
