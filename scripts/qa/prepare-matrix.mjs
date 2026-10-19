import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const stateDir = process.env.QA_STATE_DIR ?? '/qa/state';
const tokens = JSON.parse(await readFile(`${stateDir}/tokens.json`, 'utf8'));
const base = 'http://localhost:3001/v1/projects/b2000000-0000-4000-8000-000000000001/team';
const headersA = { authorization: `Bearer ${tokens.a}` };
const headersB = { authorization: `Bearer ${tokens.b}` };
const team = await (await fetch(base, { headers: headersA })).json();
const member = team.items.find((row) => row.userId === 'a1000000-0000-4000-8000-000000000002');
if (member?.status === 'accepted') {
  assert.equal((await fetch(`${base}/me`, { method: 'DELETE', headers: headersB })).status, 204);
}
if (member?.status !== 'pending') {
  assert.equal(
    (
      await fetch(base, {
        method: 'POST',
        headers: { ...headersA, 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'a1000000-0000-4000-8000-000000000002', role: 'QA member' }),
      })
    ).status,
    201,
  );
}
// The demo fixture has B's pending invitation to A's project. Accept it through
// the real endpoint to produce an unread notification for A's badge test.
const response = await fetch(`${base}/me/accept`, { method: 'POST', headers: headersB });
assert.equal(response.status, 200);
const count = await fetch('http://localhost:3001/v1/me/notifications/unread-count', {
  headers: { authorization: `Bearer ${tokens.a}` },
});
assert.equal(count.status, 200);
assert.ok((await count.json()).count > 0);
console.log('Two local accounts and an unread notification are ready.');
