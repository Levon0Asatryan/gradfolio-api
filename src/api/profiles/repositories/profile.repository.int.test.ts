import { describe, expect, it } from 'vitest';
import { newId } from '../../../core/db/ids.js';
import { testDatabase } from '../../../testing/database.js';
import { createProject, createUser } from '../../../testing/factories.js';
import { listProfileProjects } from './project-summary.repository.js';
import { findVisibleUser, updateHeader } from './profile.repository.js';

const db = testDatabase();

describe('findVisibleUser', () => {
  it('selects only the profile columns -- no login email, phone, birthday or auth0 id', async () => {
    const u = await createUser(db, {
      phone: '+1 555',
      birthday: '2000-01-01',
      email: 'a@b.example',
    });
    const row = await findVisibleUser(db, u.id, undefined);
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'avatarUrl',
        'bio',
        'contactEmail',
        'github',
        'headline',
        'id',
        'isPublic',
        'linkedin',
        'location',
        'name',
        'twitter',
        'verified',
        'website',
      ].sort(),
    );
  });

  it('applies the visibility rule in SQL: public to all, private to its owner only', async () => {
    const pub = await createUser(db, { isPublic: true });
    const priv = await createUser(db, { isPublic: false });
    const other = await createUser(db);
    expect(await findVisibleUser(db, pub.id, undefined)).toBeDefined();
    expect(await findVisibleUser(db, pub.id, other.id)).toBeDefined();
    expect(await findVisibleUser(db, priv.id, undefined)).toBeUndefined();
    expect(await findVisibleUser(db, priv.id, other.id)).toBeUndefined();
    expect(await findVisibleUser(db, priv.id, priv.id)).toBeDefined();
  });
});

describe('updateHeader', () => {
  it('counts matched rows: 1 when the values are unchanged, 0 when there is no such user', async () => {
    const u = await createUser(db, { headline: 'same' });
    expect(await updateHeader(db, u.id, { headline: 'same' })).toBe(1);
    expect(await updateHeader(db, newId(), { headline: 'same' })).toBe(0);
  });

  it('writes only the caller’s row', async () => {
    const a = await createUser(db, { headline: 'a' });
    const b = await createUser(db, { headline: 'b' });
    await updateHeader(db, a.id, { headline: 'a2', links: { github: 'https://g.example' } });
    const rows = await db.selectFrom('users').select(['id', 'headline', 'github']).execute();
    expect(rows.find((r) => r.id === a.id)).toMatchObject({
      headline: 'a2',
      github: 'https://g.example',
    });
    expect(rows.find((r) => r.id === b.id)).toMatchObject({ headline: 'b', github: null });
  });
});

describe('listProfileProjects', () => {
  it('merges own and team projects newest first and applies the limit to the merged list', async () => {
    const owner = await createUser(db);
    const peer = await createUser(db);
    const at = (n: number) => new Date(Date.UTC(2025, 0, n));
    const mine1 = await createProject(db, owner, { title: 'mine1', createdAt: at(1) });
    const theirs2 = await createProject(db, peer, { title: 'theirs2', createdAt: at(2) });
    const mine3 = await createProject(db, owner, {
      title: 'mine3',
      createdAt: at(3),
      tags: ['z', 'a'],
    });
    const theirs4 = await createProject(db, peer, { title: 'theirs4', createdAt: at(4) });
    for (const p of [theirs2, theirs4]) {
      await db
        .insertInto('projectTeamMembers')
        .values({
          id: newId(),
          projectId: p.project.id,
          userId: owner.id,
          name: 'x',
          status: 'accepted',
        })
        .execute();
    }
    void mine1;
    const all = await listProfileProjects(db, owner.id, { viewerIsOwner: false, limit: 10 });
    expect(all.map((p) => p.title)).toEqual(['theirs4', 'mine3', 'theirs2', 'mine1']);
    expect(all.find((p) => p.id === mine3.project.id)?.tags).toEqual(['z', 'a']);

    const capped = await listProfileProjects(db, owner.id, { viewerIsOwner: false, limit: 3 });
    expect(capped.map((p) => p.title)).toEqual(['theirs4', 'mine3', 'theirs2']);
  });
});
