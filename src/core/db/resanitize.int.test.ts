import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, createUser } from '../../testing/factories.js';
import { testDatabase } from '../../testing/database.js';
import { resanitizeDescriptions } from './resanitize.js';

const db = testDatabase();

beforeEach(async () => {
  await db.deleteFrom('users').execute();
});

const stored = async (id: string) =>
  (
    await db
      .selectFrom('projects')
      .select('descriptionHtml')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
  ).descriptionHtml;

describe('resanitizeDescriptions', () => {
  it('counts on a dry run, rewrites on apply, and a second apply changes nothing', async () => {
    const user = await createUser(db);
    const dirty = await createProject(db, user, {
      descriptionHtml: '<p>ok</p><img src=x onerror=alert(1)><a href="javascript:alert(1)">t</a>',
    });
    const clean = await createProject(db, user, { descriptionHtml: '<p>fine</p>' });
    const empty = await createProject(db, user, { descriptionHtml: '<script>x</script>' });
    const none = await createProject(db, user, { descriptionHtml: null });

    expect(await resanitizeDescriptions(db, { apply: false })).toEqual({
      scanned: 3,
      changed: 2,
      skipped: 0,
    });
    expect(await stored(dirty.project.id)).toContain('onerror');

    expect(await resanitizeDescriptions(db, { apply: true })).toEqual({
      scanned: 3,
      changed: 2,
      skipped: 0,
    });
    expect(await stored(dirty.project.id)).toBe('<p>ok</p><a>t</a>');
    expect(await stored(clean.project.id)).toBe('<p>fine</p>');
    expect(await stored(empty.project.id)).toBeNull();
    expect(await stored(none.project.id)).toBeNull();

    expect(await resanitizeDescriptions(db, { apply: true })).toEqual({
      scanned: 2,
      changed: 0,
      skipped: 0,
    });
  });

  it('does not count a row that changed between the read and the write', async () => {
    const user = await createUser(db);
    const dirty = await createProject(db, user, { descriptionHtml: '<p>a</p><script>x</script>' });
    // a writer commits a different (also unclean) value after the sweep read the row
    const beforeWrite = async (id: string) => {
      await db
        .updateTable('projects')
        .set({ descriptionHtml: '<p>b</p><script>y</script>' })
        .where('id', '=', id)
        .execute();
    };
    expect(await resanitizeDescriptions(db, { apply: true, beforeWrite })).toEqual({
      scanned: 1,
      changed: 0,
      skipped: 1,
    });
    // the concurrent value is untouched, and a second run picks it up
    expect(await stored(dirty.project.id)).toBe('<p>b</p><script>y</script>');
    expect(await resanitizeDescriptions(db, { apply: true })).toEqual({
      scanned: 1,
      changed: 1,
      skipped: 0,
    });
    expect(await stored(dirty.project.id)).toBe('<p>b</p>');
  });

  it('pages through more rows than one batch', async () => {
    const user = await createUser(db);
    for (let i = 0; i < 105; i++) await createProject(db, user, { descriptionHtml: '<p>x</p>' });
    expect(await resanitizeDescriptions(db, { apply: false })).toEqual({
      scanned: 105,
      changed: 0,
      skipped: 0,
    });
  });
});
