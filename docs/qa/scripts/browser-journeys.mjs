import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

// Run only with local-stack.mts and the disposable QA database.
const frontendRoot = process.env.QA_FRONTEND_ROOT ?? '/qa/gradfolio';
const stateDir = process.env.QA_STATE_DIR ?? '/qa/state';
const resultDir = process.env.QA_RESULT_DIR ?? '/qa/results/journeys';
const requireFrontend = createRequire(`${frontendRoot}/package.json`);
const { chromium, expect } = requireFrontend('@playwright/test');
const baseURL = 'http://localhost:3100';
const tokens = JSON.parse(await readFile(`${stateDir}/tokens.json`, 'utf8'));
await mkdir(resultDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const contexts = {};
const pages = {};
for (const label of ['a', 'b', 'c', 'anonymous']) {
  contexts[label] = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
    ...(label === 'anonymous' ? {} : { storageState: `${stateDir}/${label}.json` }),
  });
  await contexts[label].addCookies([{ name: 'language', value: 'en', url: baseURL }]);
  pages[label] = await contexts[label].newPage();
  pages[label].setDefaultTimeout(8000);
  pages[label].on('dialog', (dialog) =>
    dialog.type() === 'beforeunload' || dialog.type() === 'confirm'
      ? dialog.accept()
      : dialog.dismiss(),
  );
}
const a = pages.a;
const b = pages.b;
const anonymous = pages.anonymous;
const results = [];
let projectId = process.env.QA_PROJECT_ID;
let title = process.env.QA_PROJECT_TITLE ?? 'QA Հայերեն project 20261017';
const selectedCases = process.env.QA_CASES ? new Set(process.env.QA_CASES.split(',')) : null;
const ownerId = 'a1000000-0000-4000-8000-000000000001';
const memberId = 'a1000000-0000-4000-8000-000000000002';
const owned = () => {
  assert.ok(projectId, 'create-project prerequisite failed');
  return projectId;
};
async function api(label, method, path, body, expected = 200) {
  const response = await fetch(`http://localhost:3001/v1${path}`, {
    method,
    headers: {
      ...(label ? { authorization: `Bearer ${tokens[label]}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}
async function run(id, description, fn) {
  if (selectedCases && !selectedCases.has(id)) return;
  const start = Date.now();
  try {
    await fn();
    results.push({ id, description, status: 'pass', durationMs: Date.now() - start });
    console.log(`PASS ${id} ${description}`);
  } catch (error) {
    results.push({
      id,
      description,
      status: 'fail',
      durationMs: Date.now() - start,
      error: String(error.stack ?? error),
    });
    console.log(`FAIL ${id} ${description}: ${error.message}`);
    for (const label of ['a', 'b']) {
      await pages[label]
        .screenshot({ path: `${resultDir}/${id}-${label}.png`, fullPage: true })
        .catch(() => {});
    }
  }
  await writeFile(`${resultDir}/results.json`, JSON.stringify(results, null, 2));
}
async function savedProject() {
  await expect(a).toHaveURL(/\/projects\/[0-9a-f-]+\?flash=(created|saved)/, { timeout: 15000 });
  await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
}
async function invite() {
  await a.goto(`/projects/${owned()}`);
  await a.getByRole('button', { name: 'Add teammate', exact: true }).click();
  const dialog = a.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Search by name' }).fill('Дми');
  await a.getByRole('option', { name: /Дмитрий Волков/ }).click();
  await dialog
    .getByRole('textbox', { name: 'Role (optional)', exact: true })
    .fill('QA collaborator');
  await dialog.getByRole('button', { name: 'Send invitation', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await api('a', 'GET', `/projects/${owned()}/team`)).items.find(
          (row) => row.userId === memberId,
        )?.status,
    )
    .toBe('pending');
}

await run(
  'FULL-01',
  'two signed-in users reach account and dashboard through the real API',
  async () => {
    for (const label of ['a', 'b']) {
      await pages[label].goto('/account');
      await expect(
        pages[label].getByRole('heading', { name: 'My Account', exact: true }),
      ).toBeVisible();
      assert.equal(
        (await contexts[label].request.get('/api/notifications/unread-count')).status(),
        200,
      );
      await pages[label].goto('/');
      await expect(pages[label].getByRole('heading', { level: 1 })).toBeVisible();
      assert.ok(!pages[label].url().includes('/auth/login'));
    }
  },
);
await run('FULL-02', 'profile edit persists after reload and in the real API', async () => {
  await a.goto('/profile');
  await a.getByRole('button', { name: 'Edit Profile', exact: true }).click();
  await a.getByRole('textbox', { name: 'Headline', exact: true }).fill('QA փորձարկված headline');
  await a.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await api('a', 'GET', '/me/profile')).headline)
    .toBe('QA փորձարկված headline');
  await a.goto('/profile');
  await a.getByRole('button', { name: 'Edit Profile', exact: true }).click();
  await expect(a.getByRole('textbox', { name: 'Headline', exact: true })).toHaveValue(
    'QA փորձարկված headline',
  );
});
await run(
  'FULL-03',
  'create a public project through the UI and read its stored fields',
  async () => {
    await a.goto('/projects/new');
    await a.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await a
      .getByRole('textbox', { name: 'Summary', exact: true })
      .fill('QA public summary Հայերեն');
    await a.getByRole('button', { name: 'Create project', exact: true }).click();
    await savedProject();
    projectId = new URL(a.url()).pathname.split('/').at(-1);
    const stored = await api('a', 'GET', `/projects/${projectId}`);
    assert.equal(stored.title, title);
    assert.equal(stored.isDraft, false);
    assert.equal(stored.isPublic, true);
    assert.equal(stored.summary, 'QA public summary Հայերեն');
  },
);
await run(
  'FULL-04',
  'edit a project through the UI and retain the change after reload',
  async () => {
    await a.goto(`/projects/${owned()}/edit`);
    title += ' edited';
    await a.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await a.getByRole('button', { name: 'Save changes', exact: true }).click();
    await savedProject();
    await a.reload();
    await expect(a.getByRole('heading', { level: 1, name: title })).toBeVisible();
    assert.equal((await api('a', 'GET', `/projects/${owned()}`)).title, title);
  },
);
await run('FULL-05', 'unsafe URL is rejected without losing the typed project form', async () => {
  await a.goto(`/projects/${owned()}/edit`);
  const url = a.getByRole('textbox', { name: 'Live demo URL', exact: true });
  await url.fill('javascript:alert(1)');
  await a.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    a.getByRole('form', { name: 'Edit project', exact: true }).getByRole('alert'),
  ).toContainText('Please fix');
  await expect(url).toHaveValue('javascript:alert(1)');
  assert.equal((await api('a', 'GET', `/projects/${owned()}`)).liveDemoUrl, null);
  await url.fill('');
});
await run(
  'FULL-06',
  'anonymous public project back-link returns to browse without login',
  async () => {
    await anonymous.goto(`/projects/${owned()}`);
    await anonymous.getByRole('link', { name: 'Back to Projects', exact: true }).click();
    await expect(anonymous).toHaveURL(`${baseURL}/browse/projects`);
  },
);
await run('FULL-07', 'other user cannot edit, delete, or list owner-only team data', async () => {
  await b.goto(`/projects/${owned()}/edit`);
  await expect(b.getByRole('heading', { level: 1 })).toContainText('Page not found');
  await expect(b.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0);
  await api('b', 'PATCH', `/projects/${owned()}`, { title: 'forbidden' }, 404);
  await api('b', 'DELETE', `/projects/${owned()}`, undefined, 404);
  await api('b', 'GET', `/projects/${owned()}/team`, undefined, 404);
  assert.equal((await api('a', 'GET', `/projects/${owned()}`)).title, title);
});
await run(
  'FULL-08',
  'private project disappears for anonymous visitors and other users',
  async () => {
    await a.goto(`/projects/${owned()}/edit`);
    await a.getByRole('radio', { name: /^Private/ }).check();
    await a.getByRole('button', { name: 'Save changes', exact: true }).click();
    await savedProject();
    await api(null, 'GET', `/projects/${owned()}`, undefined, 404);
    await api('b', 'GET', `/projects/${owned()}`, undefined, 404);
    await anonymous.goto(`/projects/${owned()}`);
    await expect(anonymous.getByRole('heading', { level: 1 })).toContainText('Page not found');
    await a.goto(`/projects/${owned()}/edit`);
    await a.getByRole('radio', { name: /^Public/ }).check();
    await a.getByRole('button', { name: 'Save changes', exact: true }).click();
    await savedProject();
    await api(null, 'GET', `/projects/${owned()}`);
  },
);
await run('FULL-09', 'owner finds another user and sends a team invitation through the UI', invite);
await run(
  'FULL-10',
  'invitee declines through Teams and the stored membership changes',
  async () => {
    await b.goto('/teams');
    await b
      .getByRole('button', { name: `Decline the invitation to ${title}`, exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await api('a', 'GET', `/projects/${owned()}/team`)).items.find(
            (row) => row.userId === memberId,
          )?.status,
      )
      .toBe('rejected');
  },
);
await run('FULL-11', 'owner re-invites and invitee accepts through the UI', async () => {
  await a.goto(`/projects/${owned()}`);
  await a.getByRole('button', { name: 'Invite Дмитрий Волков again', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await api('a', 'GET', `/projects/${owned()}/team`)).items.find(
          (row) => row.userId === memberId,
        )?.status,
    )
    .toBe('pending');
  await b.goto('/teams');
  await b.getByRole('button', { name: `Accept the invitation to ${title}`, exact: true }).click();
  await expect
    .poll(
      async () =>
        (await api('a', 'GET', `/projects/${owned()}/team`)).items.find(
          (row) => row.userId === memberId,
        )?.status,
    )
    .toBe('accepted');
});
await run(
  'FULL-12',
  'accepted member leaves through the project UI and membership is removed',
  async () => {
    await b.goto(`/projects/${owned()}`);
    await b.getByRole('button', { name: 'Leave project', exact: true }).click();
    await b.getByRole('dialog').getByRole('button', { name: 'Leave', exact: true }).click();
    await expect
      .poll(async () =>
        (await api('a', 'GET', `/projects/${owned()}/team`)).items.some(
          (row) => row.userId === memberId,
        ),
      )
      .toBe(false);
  },
);
await run('FULL-13', 'owner adds and removes an external teammate through the UI', async () => {
  await a.goto(`/projects/${owned()}`);
  await a.getByRole('button', { name: 'Add teammate', exact: true }).click();
  const dialog = a.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Add by name', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('QA External');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(a.getByText('QA External', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Remove QA External', exact: true }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect
    .poll(async () =>
      (await api('a', 'GET', `/projects/${owned()}/team`)).items.some(
        (row) => row.name === 'QA External',
      ),
    )
    .toBe(false);
});
await run(
  'FULL-14',
  'private profile is hidden while an explicitly public project retains direct access per M4',
  async () => {
    try {
      await api('a', 'PATCH', '/me/profile', { isPublic: false });
      await api(null, 'GET', `/users/${ownerId}`, undefined, 404);
      await api(null, 'GET', `/projects/${owned()}`);
      await api('b', 'GET', `/projects/${owned()}`);
      await api('a', 'GET', `/projects/${owned()}`);
    } finally {
      await api('a', 'PATCH', '/me/profile', { isPublic: true });
    }
  },
);
await run(
  'FULL-15',
  'stored hostile HTML is sanitized before a public browser renders it',
  async () => {
    const hostile =
      '<p>Safe evidence</p><script>window.__qaXss=1</script><img src=x onerror="window.__qaXss=2"><a href="javascript:window.__qaXss=3">click</a>';
    const saved = await api('a', 'PATCH', `/projects/${owned()}`, { descriptionHtml: hostile });
    assert.ok(!/onerror|javascript:|<script/i.test(saved.descriptionHtml));
    await anonymous.goto(`/projects/${owned()}`);
    await expect(anonymous.getByText('Safe evidence', { exact: true })).toBeVisible();
    assert.equal(await anonymous.evaluate(() => window.__qaXss), undefined);
  },
);
await run(
  'FULL-16',
  'Unicode and special-character tags preserve their route and duplicate terms collapse',
  async () => {
    const saved = await api('a', 'PATCH', `/projects/${owned()}`, {
      tags: ['C#', 'CI/CD', 'Հայերեն'],
      technologies: ['Go', 'go', 'TypeScript'],
    });
    assert.deepEqual(saved.technologies, ['Go', 'TypeScript']);
    for (const tag of ['C#', 'CI/CD', 'Հայերեն']) {
      await anonymous.goto(`/tags/${encodeURIComponent(tag)}`);
      await expect(anonymous.getByRole('heading', { level: 1 })).toContainText(tag);
      await expect(anonymous.getByRole('link', { name: new RegExp(title) }).first()).toBeVisible();
    }
  },
);
await run(
  'FULL-17',
  'a draft stays private until the owner publishes it through the UI',
  async () => {
    const draft = await api(
      'a',
      'POST',
      '/projects',
      { title: 'QA draft', isDraft: true, isPublic: true },
      201,
    );
    try {
      await api(null, 'GET', `/projects/${draft.id}`, undefined, 404);
      await a.goto(`/projects/${draft.id}/edit`);
      await a.getByRole('button', { name: 'Publish this draft', exact: true }).click();
      await a.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(a).toHaveURL(new RegExp(`/projects/${draft.id}\\?flash=saved`));
      assert.equal((await api(null, 'GET', `/projects/${draft.id}`)).isDraft, false);
    } finally {
      await api('a', 'DELETE', `/projects/${draft.id}`, undefined, 204);
    }
  },
);
await run('FULL-18', 'delete project confirmation removes the real project', async () => {
  const disposable = await api('a', 'POST', '/projects', { title: 'QA disposable delete' }, 201);
  await a.goto(`/projects/${disposable.id}/edit`);
  await a.getByRole('button', { name: 'Delete project', exact: true }).first().click();
  const dialog = a.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(a).toHaveURL(/\/projects\?flash=deleted/);
  await api('a', 'GET', `/projects/${disposable.id}`, undefined, 404);
});
await run('FULL-19', 'concurrent first requests create one stable local account', async () => {
  const first = await Promise.all(Array.from({ length: 12 }, () => api('d', 'GET', '/me')));
  assert.equal(new Set(first.map((me) => me.id)).size, 1);
  assert.equal((await api('d', 'GET', '/me')).id, first[0].id);
});
await run(
  'FULL-20',
  'account deletion through the UI signs out and removes the profile',
  async () => {
    const me = await api('c', 'GET', '/me');
    await api('c', 'POST', '/me/onboarding/complete', {});
    const c = pages.c;
    let logout = false;
    await c.route('**/auth/logout**', async (route) => {
      logout = true;
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Signed out</h1>' });
    });
    await c.goto('/account');
    await c.getByRole('button', { name: 'Delete my account', exact: true }).click();
    const dialog = c.getByRole('dialog');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
    await expect.poll(() => logout).toBe(true);
    await api(null, 'GET', `/users/${me.id}`, undefined, 404);
  },
);
await run('FULL-21', 'missing, malformed and expired access tokens are rejected', async () => {
  await api(null, 'GET', '/me', undefined, 401);
  await api('expired', 'GET', '/me', undefined, 401);
  const response = await fetch('http://localhost:3001/v1/me', {
    headers: { authorization: 'Bearer malformed' },
  });
  assert.equal(response.status, 401);
});
await run(
  'FULL-22',
  'education UI creates, edits, reorders and deletes a stored entry',
  async () => {
    const existing = await api('a', 'GET', `/users/${ownerId}`);
    for (const row of existing.education.filter((entry) => entry.institution === 'QA University')) {
      await api('a', 'DELETE', `/me/education/${row.id}`, undefined, 204);
    }
    await a.goto('/profile');
    await a.getByRole('button', { name: 'Add education', exact: true }).click();
    let dialog = a.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Institution', exact: true }).fill('QA University');
    await dialog.getByRole('textbox', { name: 'Degree', exact: true }).fill('QA Degree');
    await dialog.getByRole('textbox', { name: 'Field of study', exact: true }).fill('QA Field');
    await dialog.getByRole('spinbutton', { name: 'Start year', exact: true }).fill('2020');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () =>
        (await api('a', 'GET', `/users/${ownerId}`)).education.some(
          (row) => row.institution === 'QA University',
        ),
      )
      .toBe(true);
    await a.getByRole('button', { name: 'Edit: QA Degree, QA University', exact: true }).click();
    dialog = a.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Degree', exact: true }).fill('QA Degree edited');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await a
      .getByRole('button', { name: 'Move down: QA Degree edited, QA University', exact: true })
      .click();
    await expect
      .poll(async () => (await api('a', 'GET', `/users/${ownerId}`)).education[1]?.degree)
      .toBe('QA Degree edited');
    await a
      .getByRole('button', { name: 'Move up: QA Degree edited, QA University', exact: true })
      .click();
    await expect
      .poll(async () => (await api('a', 'GET', `/users/${ownerId}`)).education[0]?.degree)
      .toBe('QA Degree edited');
    await a
      .getByRole('button', { name: 'Delete: QA Degree edited, QA University', exact: true })
      .click();
    await a.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect
      .poll(async () =>
        (await api('a', 'GET', `/users/${ownerId}`)).education.some(
          (row) => row.institution === 'QA University',
        ),
      )
      .toBe(false);
  },
);
await run(
  'FULL-23',
  'skills UI keeps one canonical skill after a case-variant duplicate',
  async () => {
    const skillName = `QA Skill ${Date.now()}`;
    await a.goto('/profile');
    await a.getByRole('button', { name: 'Edit skills', exact: true }).click();
    const input = a.getByRole('textbox', { name: 'New Skill', exact: true });
    for (const skill of [skillName, skillName.toLowerCase()]) {
      await input.fill(skill);
      await input.press('Enter');
    }
    await a.getByRole('button', { name: 'Save skills', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await api('a', 'GET', `/users/${ownerId}`)).skills.filter(
            (skill) => skill.toLowerCase() === skillName.toLowerCase(),
          ).length,
      )
      .toBe(1);
    await a.reload();
    await expect(a.getByText(skillName, { exact: true })).toBeVisible();
  },
);
await run(
  'FULL-24',
  'attachment link UI persists add, edit and deletion without saving the project form',
  async () => {
    await a.goto(`/projects/${owned()}/edit`);
    await a.getByRole('button', { name: 'Add attachment', exact: true }).click();
    let dialog = a.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: 'Address (https://)', exact: true })
      .fill('https://example.com/qa-evidence');
    await dialog
      .getByRole('textbox', { name: 'Title (optional)', exact: true })
      .fill('QA Evidence');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () =>
        (await api('a', 'GET', `/projects/${owned()}`)).attachments.some(
          (row) => row.title === 'QA Evidence',
        ),
      )
      .toBe(true);
    await a.getByRole('button', { name: 'Edit QA Evidence', exact: true }).click();
    dialog = a.getByRole('dialog');
    await dialog
      .getByRole('textbox', { name: 'Title (optional)', exact: true })
      .fill('QA Evidence edited');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await a.reload();
    await expect(
      a.getByRole('button', { name: 'Edit QA Evidence edited', exact: true }),
    ).toBeVisible();
    await a.getByRole('button', { name: 'Remove QA Evidence edited', exact: true }).click();
    await a
      .getByRole('dialog')
      .getByRole('button', { name: 'Delete project', exact: true })
      .click();
    await expect
      .poll(async () => (await api('a', 'GET', `/projects/${owned()}`)).attachments.length)
      .toBe(0);
  },
);
await browser.close();
console.log(
  JSON.stringify({
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    total: results.length,
  }),
);
if (results.some((r) => r.status === 'fail')) process.exitCode = 1;
