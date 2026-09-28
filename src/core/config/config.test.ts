import { describe, expect, it } from 'vitest';
import { loadConfig, parseByteSize } from './index.js';

const DATABASE_URL = 'mysql://gradfolio:gradfolio@localhost:3306/gradfolio';

describe('loadConfig', () => {
  it('applies defaults when only the required keys are set', () => {
    const cfg = loadConfig({ DATABASE_URL });

    expect(cfg).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_PORT: 3000,
      API_BODY_LIMIT: '256kb',
      API_DOCS_ENABLED: false,
      TRUST_PROXY: false,
      DATABASE_POOL_MAX: 10,
      DATABASE_SSL: 'off',
    });
  });

  it('refuses to boot without DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('refuses a non-mysql database URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@h/db' })).toThrow(/mysql:\/\//);
  });

  it('names every offending key, not only the first', () => {
    expect(() => loadConfig({ DATABASE_URL, API_PORT: '0', LOG_LEVEL: 'loud' })).toThrow(
      /API_PORT[\s\S]*LOG_LEVEL|LOG_LEVEL[\s\S]*API_PORT/,
    );
  });

  it.each(['yes', '1', 'TRUE', ''])('refuses %j as a boolean switch', (value) => {
    expect(() => loadConfig({ DATABASE_URL, API_DOCS_ENABLED: value })).toThrow(/API_DOCS_ENABLED/);
  });

  it('parses boolean switches', () => {
    const cfg = loadConfig({ DATABASE_URL, API_DOCS_ENABLED: 'true', TRUST_PROXY: 'true' });
    expect(cfg.API_DOCS_ENABLED).toBe(true);
    expect(cfg.TRUST_PROXY).toBe(true);
  });

  it.each(['64kbb', 'abc', '0kb', '64', '9mb'])('refuses body limit %j', (value) => {
    expect(() => loadConfig({ DATABASE_URL, API_BODY_LIMIT: value })).toThrow(/API_BODY_LIMIT/);
  });

  it('names the root when the environment is not an object at all', () => {
    expect(() => loadConfig('not-an-env' as unknown as NodeJS.ProcessEnv)).toThrow(/\(root\)/);
  });

  it('requires TLS to the database in production', () => {
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: 'production' })).toThrow(/DATABASE_SSL/);
    expect(
      loadConfig({ DATABASE_URL, NODE_ENV: 'production', DATABASE_SSL: 'required' }).DATABASE_SSL,
    ).toBe('required');
  });
});

describe('parseByteSize', () => {
  it.each([
    ['1kb', 1024],
    ['256kb', 262_144],
    ['8mb', 8 * 1024 * 1024],
  ])('%s is %d bytes', (input, bytes) => {
    expect(parseByteSize(input)).toBe(bytes);
  });

  it.each(['', 'kb', '1.5mb', '1gb', '-1kb', '01kb'])('rejects %j', (input) => {
    expect(parseByteSize(input)).toBeUndefined();
  });
});
