import { beforeEach, describe, expect, it } from 'vitest';
import { testDatabase } from '../../testing/database.js';
import { createProject, createUser } from '../../testing/factories.js';
import { FakeFileStorage } from '../../testing/fake-storage.js';
import { canonicalObjectUrl } from './file-rules.js';
import { sweepOrphans } from './sweep.js';

const db = testDatabase();
const B = 'test-bucket';
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-09T12:00:00Z');
const old = new Date(NOW - 2 * DAY);
const fresh = new Date(NOW - 3_600_000);
const png = Buffer.from('x');

beforeEach(async () => {
  await db.deleteFrom('users').execute();
});

describe('sweepOrphans', () => {
  it('deletes old unreferenced objects only, and counts every kind of reference as one', async () => {
    const storage = new FakeFileStorage(B);
    const user = await createUser(db);
    const key = (n: string) => `u/${user.id}/${n}.png`;
    const url = (n: string) => canonicalObjectUrl(B, key(n));
    await db
      .updateTable('users')
      .set({ avatarUrl: url('avatar') })
      .where('id', '=', user.id)
      .execute();
    await createProject(db, user, {
      heroImageUrl: url('hero'),
      attachments: [
        { type: 'image', url: url('att') },
        { type: 'link', url: 'https://external.example/x' },
      ],
    });
    for (const n of ['avatar', 'hero', 'att', 'orphan-old'])
      storage.put(key(n), png, 'image/png', old);
    storage.put(key('orphan-fresh'), png, 'image/png', fresh);
    storage.put('elsewhere/x.png', png, 'image/png', old); // outside u/: never touched

    const dry = await sweepOrphans(db, storage, B, { apply: false, minAgeMs: DAY, now: NOW });
    expect(dry).toEqual({ scanned: 5, orphans: [key('orphan-old')], deleted: 0, kept: 0 });
    expect(storage.deleted).toEqual([]);

    const done = await sweepOrphans(db, storage, B, { apply: true, minAgeMs: DAY, now: NOW });
    expect(done.deleted).toBe(1);
    expect(storage.deleted).toEqual([key('orphan-old')]);
    expect([...storage.objects.keys()].sort()).toEqual(
      [key('att'), key('avatar'), key('hero'), key('orphan-fresh'), 'elsewhere/x.png'].sort(),
    );

    // a second run finds nothing: safe to repeat
    expect(
      (await sweepOrphans(db, storage, B, { apply: true, minAgeMs: DAY, now: NOW })).deleted,
    ).toBe(0);
  });

  it('a file whose row is gone is an orphan from then on', async () => {
    const storage = new FakeFileStorage(B);
    const user = await createUser(db);
    const k = `u/${user.id}/h.png`;
    const { project } = await createProject(db, user, { heroImageUrl: canonicalObjectUrl(B, k) });
    storage.put(k, png, 'image/png', old);
    expect(
      (await sweepOrphans(db, storage, B, { apply: false, minAgeMs: DAY, now: NOW })).orphans,
    ).toEqual([]);
    await db.deleteFrom('projects').where('id', '=', project.id).execute();
    expect(
      (await sweepOrphans(db, storage, B, { apply: false, minAgeMs: DAY, now: NOW })).orphans,
    ).toEqual([k]);
  });

  it('keeps an orphan that was registered after it was listed', async () => {
    const storage = new FakeFileStorage(B);
    const user = await createUser(db);
    const k = `u/${user.id}/late.png`;
    storage.put(k, png, 'image/png', old);
    // between the listing and the delete, accept() claims the object (its row commits next)
    storage.afterList = async () => {
      const info = (await storage.stat(k))!;
      expect(await storage.claim(k, info, 'hero')).toBe(true);
    };
    const res = await sweepOrphans(db, storage, B, { apply: true, minAgeMs: DAY, now: NOW });
    expect(res).toEqual({ scanned: 1, orphans: [k], deleted: 0, kept: 1 });
    expect(storage.objects.has(k)).toBe(true);
    expect(storage.deleted).toEqual([]);
  });

  it('keeps an orphan whose bytes were replaced after it was listed', async () => {
    const storage = new FakeFileStorage(B);
    const user = await createUser(db);
    const k = `u/${user.id}/swapped.png`;
    storage.put(k, png, 'image/png', old);
    storage.afterList = () => {
      storage.put(k, Buffer.from('new bytes'), 'image/png', old);
      return Promise.resolve();
    };
    const res = await sweepOrphans(db, storage, B, { apply: true, minAgeMs: DAY, now: NOW });
    expect(res.kept).toBe(1);
    expect(storage.objects.get(k)?.body.toString()).toBe('new bytes');
  });

  it('holds back a freshly claimed object whose row has not committed yet, by the age floor', async () => {
    const storage = new FakeFileStorage(B);
    const user = await createUser(db);
    const k = `u/${user.id}/claimed.png`;
    storage.put(k, png, 'image/png', old);
    // claimed before the sweep started, row not committed: the claim refreshed `updated`
    const info = (await storage.stat(k))!;
    expect(await storage.claim(k, info, 'hero')).toBe(true);
    const res = await sweepOrphans(db, storage, B, { apply: true, minAgeMs: DAY, now: Date.now() });
    expect(res).toMatchObject({ orphans: [], deleted: 0 });
  });
});
