import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { GithubAccessToken } from '../github/github-access-token.js';
import { Secret } from './secret.js';

describe('Secret and GithubAccessToken (docs/modules/m7/plan.md §10: prints nothing)', () => {
  const value = 'gho_SENTINEL_print';

  it.each([
    ['Secret', new Secret(value)],
    ['GithubAccessToken', new GithubAccessToken(value)],
  ])('%s: JSON, a template string, util.inspect and a logger all print [redacted]', (_n, s) => {
    expect(JSON.stringify({ token: s })).toBe('{"token":"[redacted]"}');
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- the point of the test
    expect(`${s}`).toBe('[redacted]');
    expect(String(s)).toBe('[redacted]');
    expect(inspect(s)).toBe('[redacted]');
    expect(inspect({ nested: { s } }, { depth: 5 })).not.toContain(value);

    const lines: string[] = [];
    const logger = pino(
      new Writable({
        write(chunk: Buffer, _e, cb) {
          lines.push(chunk.toString());
          cb();
        },
      }),
    );
    logger.info({ holder: s, list: [s] }, 'holding a token');
    expect(lines.join('')).not.toContain(value);
    expect(lines.join('')).toContain('[redacted]');

    expect(s.reveal()).toBe(value);
  });
});
