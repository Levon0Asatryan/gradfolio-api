import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCommitted } from './cli.js';

describe('readCommitted', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('returns the file content', async () => {
    dir = await mkdtemp(join(tmpdir(), 'openapi-'));
    await writeFile(join(dir, 'openapi.yaml'), 'openapi: 3.0.3\n');
    await expect(readCommitted(join(dir, 'openapi.yaml'))).resolves.toBe('openapi: 3.0.3\n');
  });

  it('reads a missing file as undefined', async () => {
    dir = await mkdtemp(join(tmpdir(), 'openapi-'));
    await expect(readCommitted(join(dir, 'absent.yaml'))).resolves.toBeUndefined();
  });

  it('surfaces any other failure instead of calling it missing', async () => {
    // A directory fails with EISDIR for every user, root included -- unlike a
    // permission bit, which root ignores.
    dir = await mkdtemp(join(tmpdir(), 'openapi-'));
    await expect(readCommitted(dir)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
