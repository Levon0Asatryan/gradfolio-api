import { describe, expect, it } from 'vitest';
import { FakeFileStorage } from '../../testing/fake-storage.js';
import { importKey, importPrefix, IMPORTS_ROOT } from './file-rules.js';
import { sweepImports } from './sweep-imports.js';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 1, 12);

function setup() {
  const storage = new FakeFileStorage();
  const old = new Date(NOW - 30 * HOUR);
  const fresh = new Date(NOW - HOUR);
  storage.put(importKey('u1', 'old'), Buffer.from('x'), 'application/zip', old);
  storage.put(importKey('u2', 'fresh'), Buffer.from('x'), 'application/zip', fresh);
  storage.put('u/u1/avatar.png', Buffer.from('x'), 'image/png', old);
  return storage;
}

describe('sweepImports', () => {
  it('lists export ZIPs older than the floor and deletes nothing on a dry run', async () => {
    const storage = setup();
    const r = await sweepImports(storage, { apply: false, minAgeMs: 24 * HOUR, now: NOW });
    expect(r).toEqual({ scanned: 2, stale: [importKey('u1', 'old')], deleted: 0, kept: 0 });
    expect(storage.deleted).toEqual([]);
  });

  it('deletes only stale ZIPs under imports/, never an upload under u/', async () => {
    const storage = setup();
    const r = await sweepImports(storage, { apply: true, minAgeMs: 24 * HOUR, now: NOW });
    expect(r.deleted).toBe(1);
    expect(storage.deleted).toEqual([importKey('u1', 'old')]);
    expect(storage.objects.has('u/u1/avatar.png')).toBe(true);
  });

  it('keeps an object that changed after it was listed', async () => {
    const storage = setup();
    storage.afterList = async () => {
      storage.put(importKey('u1', 'old'), Buffer.from('replaced'), 'application/zip');
      await Promise.resolve();
    };
    const r = await sweepImports(storage, { apply: true, minAgeMs: 24 * HOUR, now: NOW });
    expect(r).toMatchObject({ deleted: 0, kept: 1 });
  });
});

describe('import keys', () => {
  it('sit under imports/<userId>/, so another user’s id finds nothing', () => {
    expect(IMPORTS_ROOT).toBe('imports/');
    expect(importPrefix('u1')).toBe('imports/u1/');
    expect(importKey('u1', 'abc')).toBe('imports/u1/abc.zip');
    expect(importKey('u1', 'abc')).not.toBe(importKey('u2', 'abc'));
  });
});
