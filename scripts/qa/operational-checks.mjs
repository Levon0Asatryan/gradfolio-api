import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { requireQaDatabase } from './qa-database.mjs';

const stateDir = process.env.QA_STATE_DIR ?? '/qa/state';
const resultDir = process.env.QA_RESULT_DIR ?? '/qa/results/operations';
await mkdir(resultDir, { recursive: true });
requireQaDatabase(process.env.DATABASE_URL, process.env.DATABASE_SOCKET_PATH);
const { issuer, audience } = JSON.parse(await readFile(`${stateDir}/issuer.json`, 'utf8'));
const tokens = JSON.parse(await readFile(`${stateDir}/tokens.json`, 'utf8'));
const env = {
  ...process.env,
  NODE_ENV: 'development',
  LOG_LEVEL: 'error',
  API_PORT: '3002',
  AUTH0_ISSUER_BASE_URL: issuer,
  AUTH0_AUDIENCE: audience,
};
delete env.RATE_LIMIT_DEFAULT;
delete env.RATE_LIMIT_SEARCH;
const results = [];
async function run(id, description, fn) {
  try {
    const evidence = await fn();
    results.push({ id, description, status: 'pass', evidence });
    console.log(`PASS ${id} ${description}`);
  } catch (error) {
    results.push({ id, description, status: 'fail', error: String(error.stack ?? error) });
    console.log(`FAIL ${id} ${description}: ${error.message}`);
  }
  await writeFile(`${resultDir}/results.json`, JSON.stringify(results, null, 2));
}
await run('OPS-LOCAL-01', 'startup rejects missing issuer and audience', () => {
  const invalid = { ...env };
  delete invalid.AUTH0_ISSUER_BASE_URL;
  delete invalid.AUTH0_AUDIENCE;
  const child = spawnSync(process.execPath, ['dist/api/main.js'], {
    env: invalid,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /AUTH0_ISSUER_BASE_URL/);
  assert.match(child.stderr, /AUTH0_AUDIENCE/);
  return { exitCode: child.status, rejectedFields: ['AUTH0_ISSUER_BASE_URL', 'AUTH0_AUDIENCE'] };
});
await run('OPS-LOCAL-02', 'startup rejects invalid API port', () => {
  const child = spawnSync(process.execPath, ['dist/api/main.js'], {
    env: { ...env, API_PORT: '70000' },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /API_PORT/);
  return { exitCode: child.status };
});
await run('OPS-LOCAL-03', 'production rejects plaintext database transport', () => {
  const child = spawnSync(process.execPath, ['dist/api/main.js'], {
    env: {
      ...env,
      NODE_ENV: 'production',
      DATABASE_SSL: 'off',
      AUTH0_ISSUER_BASE_URL: 'https://qa.example.test/',
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /DATABASE_SSL/);
  return { exitCode: child.status };
});
const child = spawn(process.execPath, ['dist/api/main.js'], {
  env,
  stdio: ['ignore', 'ignore', 'pipe'],
});
let startupErrors = '';
child.stderr.on('data', (data) => {
  startupErrors += data.toString();
});
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch('http://localhost:3002/readyz')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, startupErrors || 'default-limit QA API failed to start');
  const base = 'http://localhost:3002';
  const auth = { authorization: `Bearer ${tokens.a}` };
  await run(
    'OPS-LOCAL-04',
    'unknown route and unsupported method return safe JSON errors',
    async () => {
      const out = [];
      for (const [method, path] of [
        ['GET', '/v1/qa-unknown'],
        ['PUT', '/v1/projects/qa-unknown'],
      ]) {
        const response = await fetch(`${base}${path}`, { method, headers: auth });
        assert.equal(response.status, 404);
        const body = await response.json();
        assert.equal(typeof body.code, 'string');
        assert.ok(!/stack|SELECT |node_modules|mysql:\/\//i.test(JSON.stringify(body)));
        out.push({ method, status: response.status, code: body.code });
      }
      return out;
    },
  );
  await run(
    'OPS-LOCAL-05',
    'malformed JSON and oversized JSON return stable client errors',
    async () => {
      const out = [];
      for (const [body, expected] of [
        ['{', 400],
        [JSON.stringify({ title: 'x'.repeat(300000) }), 413],
      ]) {
        const response = await fetch(`${base}/v1/projects`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body,
        });
        assert.equal(response.status, expected);
        const data = await response.json();
        assert.equal(typeof data.code, 'string');
        assert.ok(!/stack|node_modules|mysql:\/\//i.test(JSON.stringify(data)));
        out.push({ status: response.status, code: data.code });
      }
      return out;
    },
  );
  await run(
    'OPS-LOCAL-06',
    'default 120-request budget returns 429 and leaves another user unaffected',
    async () => {
      const statuses = [];
      for (let i = 0; i < 121; i++) {
        const response = await fetch(`${base}/v1/me`, { headers: auth });
        statuses.push(response.status);
        if (i === 120) {
          assert.equal(response.status, 429);
          assert.ok(Number(response.headers.get('retry-after')) > 0);
          assert.equal((await response.json()).code, 'RATE_LIMITED');
        } else {
          assert.equal(response.status, 200, `request ${i + 1}`);
          await response.arrayBuffer();
        }
      }
      const other = await fetch(`${base}/v1/me`, {
        headers: { authorization: `Bearer ${tokens.b}` },
      });
      assert.equal(other.status, 200);
      return {
        passedBeforeLimit: statuses.filter((s) => s === 200).length,
        limited: 429,
        otherUser: other.status,
      };
    },
  );
  await run(
    'OPS-LOCAL-07',
    'signed-in search budget allows 30 calls and limits the 31st',
    async () => {
      for (let i = 0; i < 31; i++) {
        const response = await fetch(`${base}/v1/search?q=Go`, { headers: auth });
        assert.equal(response.status, i < 30 ? 200 : 429, `request ${i + 1}`);
        await response.arrayBuffer();
      }
      return { passedBeforeLimit: 30, limited: 429 };
    },
  );
  await run(
    'OPS-LOCAL-08',
    '100 real API reads at concurrency 10 complete without server errors',
    async () => {
      const timings = [];
      for (let batch = 0; batch < 10; batch++) {
        await Promise.all(
          Array.from({ length: 10 }, async () => {
            const start = performance.now();
            const response = await fetch(
              'http://localhost:3001/v1/projects/b2000000-0000-4000-8000-000000000001',
            );
            assert.equal(response.status, 200);
            await response.arrayBuffer();
            timings.push(performance.now() - start);
          }),
        );
      }
      timings.sort((a, b) => a - b);
      return {
        requests: 100,
        concurrency: 10,
        status: 200,
        medianMs: Math.round(timings[49]),
        p95Ms: Math.round(timings[94]),
        maxMs: Math.round(timings.at(-1)),
      };
    },
  );
} finally {
  child.kill();
}
console.log(
  JSON.stringify({
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    total: results.length,
  }),
);
if (results.some((r) => r.status === 'fail')) process.exitCode = 1;
