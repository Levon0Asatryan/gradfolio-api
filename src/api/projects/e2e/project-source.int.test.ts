import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { captureLogs } from '../../../testing/app.js';
import { createProject } from '../../../testing/factories.js';
import { startTestTenant, type TestTenant } from '../../../testing/jwks.js';
import { db, person, startTeamApp } from '../../../testing/team.js';

/**
 * M7 PR (b2): `source` (`manual` | `github`) is on every project shape the
 * frontend renders as a summary: the projects lists, the profile's projects,
 * the discovery cards (search, browse, tag pages) and the dashboard's recent
 * projects. Each shape is read from a real row, so a column that is selected
 * but not mapped (or the other way round) fails here.
 */

let tenant: TestTenant;
let app: NestExpressApplication | undefined;
const logs = captureLogs();
beforeAll(async () => {
  tenant = await startTestTenant();
});
afterAll(() => tenant.close());
beforeEach(async () => {
  await db.deleteFrom('users').execute();
});
afterEach(async () => {
  logs.clear();
  await app?.close();
  app = undefined;
});

interface Item {
  title: string;
  source?: string;
}
const bySource = (items: Item[]) =>
  Object.fromEntries(
    items.filter((i) => i.title.startsWith('Src')).map((i) => [i.title, i.source]),
  );

describe('source on the summary shapes', () => {
  it('says github for an imported project and manual for the rest, in every list shape', async () => {
    const started = await startTeamApp(tenant, logs);
    app = started.app;
    const { http } = started;
    const owner = await person(tenant, 'owner', { isPublic: true });
    const viewer = await person(tenant, 'viewer', { isPublic: true });
    await createProject(db, owner.user, {
      title: 'Src GitHub import',
      summary: 'srcmarker alpha',
      source: 'github',
      githubRepoId: 7001,
      repoStars: 4,
    });
    await createProject(db, owner.user, { title: 'Src by hand', summary: 'srcmarker beta' });
    const expected = { 'Src GitHub import': 'github', 'Src by hand': 'manual' };

    // The projects lists (summary shape), for the owner and for a visitor.
    const mine = await http.get('/v1/me/projects').set(owner.auth).expect(200);
    expect(bySource(mine.body.items)).toEqual(expected);
    const theirs = await http.get(`/v1/users/${owner.user.id}/projects`).set(viewer.auth);
    expect(bySource(theirs.body.items)).toEqual(expected);

    // The profile's projects.
    const profile = await http.get(`/v1/users/${owner.user.id}`).set(viewer.auth).expect(200);
    expect(bySource(profile.body.projects)).toEqual(expected);

    // Discovery cards: search, browse, the tag page.
    const search = await http.get('/v1/search?q=srcmarker').set(viewer.auth).expect(200);
    expect(bySource(search.body.projects.items)).toEqual(expected);
    const browse = await http.get('/v1/projects?limit=20').set(viewer.auth).expect(200);
    expect(bySource(browse.body.items)).toEqual(expected);
    const tagged = await http.get('/v1/tags/projects?name=TypeScript').set(viewer.auth).expect(200);
    expect(bySource(tagged.body.items)).toEqual(expected);

    // The dashboard's recent projects.
    const dash = await http.get('/v1/me/dashboard').set(owner.auth).expect(200);
    expect(bySource(dash.body.recentProjects)).toEqual(expected);
  });
});
