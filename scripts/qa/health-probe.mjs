import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const expected = Number(process.env.QA_EXPECT_READY_STATUS ?? '200');
const results = [];
for (const path of ['/healthz', '/readyz']) {
  let response;
  for (let attempt = 0; attempt < 30; attempt++) {
    response = await fetch(`http://localhost:3001${path}`);
    if (response.status === (path === '/healthz' ? 200 : expected)) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(response.status, path === '/healthz' ? 200 : expected);
  results.push({ path, status: response.status, body: await response.json() });
}
await writeFile(`/qa/results/recovery-${expected}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
