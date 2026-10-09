import { describe, expect, it } from 'vitest';
import { loadConfig, loadDatabaseConfig, parseByteSize } from './index.js';

const DATABASE_URL = 'mysql://gradfolio:gradfolio@localhost:3306/gradfolio';
const AUTH = {
  AUTH0_ISSUER_BASE_URL: 'https://tenant.eu.auth0.com/',
  AUTH0_AUDIENCE: 'https://api.gradfolio.app',
};
const REQUIRED = { DATABASE_URL, ...AUTH };

describe('loadConfig', () => {
  it('applies defaults when only the required keys are set', () => {
    const cfg = loadConfig(REQUIRED);

    expect(cfg).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_PORT: 3000,
      API_BODY_LIMIT: '256kb',
      API_DOCS_ENABLED: false,
      TRUST_PROXY: false,
      DATABASE_POOL_MAX: 10,
      DATABASE_SSL: 'off',
      MIGRATION_LOCK_TIMEOUT_S: 60,
      AUTH0_JWKS_TIMEOUT_MS: 3000,
      AUTH0_CLOCK_TOLERANCE_S: 5,
      RATE_LIMIT_WINDOW_S: 60,
      RATE_LIMIT_DEFAULT: 120,
      RATE_LIMIT_SEARCH: 30,
      RATE_LIMIT_IMPORT: 5,
      RATE_LIMIT_AI: 10,
      RATE_LIMIT_UPLOAD: 20,
      UPLOAD_MAX_IMAGE_BYTES: 5_000_000,
      UPLOAD_MAX_PDF_BYTES: 20_000_000,
      UPLOAD_URL_TTL_S: 300,
      FILE_READ_URL_TTL_S: 300,
      UPLOAD_MAX_FILES_PER_USER: 200,
      PROJECT_MAX_ATTACHMENTS: 20,
      PROFILE_PROJECTS_LIMIT: 50,
      PROFILE_MAX_SECTION_ITEMS: 50,
      PROFILE_MAX_SKILLS: 100,
      PROJECT_MAX_PER_USER: 100,
      PROJECT_MAX_TAGS: 20,
      PROJECT_MAX_TECHNOLOGIES: 30,
      PROJECT_MAX_LINKS: 10,
      PROJECT_DESCRIPTION_MAX_BYTES: 100_000,
      PROJECTS_PAGE_SIZE: 20,
      PROJECTS_PAGE_MAX: 50,
      ATTACHMENT_VIDEO_HOSTS: [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'youtu.be',
        'vimeo.com',
        'player.vimeo.com',
      ],
    });
  });

  it('refuses to boot without DATABASE_URL', () => {
    expect(() => loadConfig(AUTH)).toThrow(/DATABASE_URL/);
  });

  it.each(['AUTH0_ISSUER_BASE_URL', 'AUTH0_AUDIENCE'])('refuses to boot without %s', (key) => {
    const env: NodeJS.ProcessEnv = { ...REQUIRED };
    delete env[key];
    expect(() => loadConfig(env)).toThrow(new RegExp(key));
  });

  it('refuses an empty audience', () => {
    expect(() => loadConfig({ ...REQUIRED, AUTH0_AUDIENCE: '  ' })).toThrow(/AUTH0_AUDIENCE/);
  });

  it.each([
    ['https://tenant.eu.auth0.com/', 'https://tenant.eu.auth0.com/'],
    ['https://tenant.eu.auth0.com', 'https://tenant.eu.auth0.com/'],
    ['https://TENANT.eu.auth0.com', 'https://tenant.eu.auth0.com/'],
    ['http://127.0.0.1:4010/', 'http://127.0.0.1:4010/'],
  ])('normalizes the issuer %j to %j (one trailing slash)', (input, issuer) => {
    expect(loadConfig({ ...REQUIRED, AUTH0_ISSUER_BASE_URL: input }).AUTH0_ISSUER_BASE_URL).toBe(
      issuer,
    );
  });

  it.each([
    'tenant.eu.auth0.com',
    'https://tenant.eu.auth0.com/api/v2/',
    'https://tenant.eu.auth0.com/?x=1',
    'https://tenant.eu.auth0.com/#x',
    'https://user:pass@tenant.eu.auth0.com/',
    'ftp://tenant.eu.auth0.com/',
  ])('refuses the issuer %j', (value) => {
    expect(() => loadConfig({ ...REQUIRED, AUTH0_ISSUER_BASE_URL: value })).toThrow(
      /AUTH0_ISSUER_BASE_URL/,
    );
  });

  it('requires an https issuer in production', () => {
    const prod = { ...REQUIRED, NODE_ENV: 'production', DATABASE_SSL: 'required' };
    expect(() => loadConfig({ ...prod, AUTH0_ISSUER_BASE_URL: 'http://tenant.test/' })).toThrow(
      /AUTH0_ISSUER_BASE_URL: must be https in production/,
    );
    expect(loadConfig(prod).AUTH0_ISSUER_BASE_URL).toBe('https://tenant.eu.auth0.com/');
  });

  it.each([
    ['AUTH0_JWKS_TIMEOUT_MS', '99'],
    ['AUTH0_JWKS_TIMEOUT_MS', '30001'],
    ['AUTH0_CLOCK_TOLERANCE_S', '-1'],
    ['AUTH0_CLOCK_TOLERANCE_S', '61'],
    ['RATE_LIMIT_WINDOW_S', '0'],
    ['RATE_LIMIT_DEFAULT', '0'],
    ['RATE_LIMIT_SEARCH', 'many'],
    ['RATE_LIMIT_IMPORT', '1.5'],
    ['RATE_LIMIT_AI', '-3'],
    ['PROFILE_MAX_SECTION_ITEMS', '0'],
    ['PROFILE_MAX_SKILLS', '1001'],
    ['PROFILE_PROJECTS_LIMIT', '0'],
    ['PROFILE_PROJECTS_LIMIT', '501'],
    ['PROJECT_MAX_PER_USER', '0'],
    ['PROJECT_MAX_TAGS', '101'],
    ['PROJECT_DESCRIPTION_MAX_BYTES', '10'],
    ['STORAGE_BUCKET', 'Not A Bucket'],
    ['STORAGE_BUCKET', 'a'],
    ['UPLOAD_URL_TTL_S', '10'],
    ['FILE_READ_URL_TTL_S', '7200'],
    ['UPLOAD_MAX_IMAGE_BYTES', '10'],
    ['PROJECTS_PAGE_SIZE', '0'],
    ['PROJECTS_PAGE_MAX', '201'],
  ])('refuses %s=%j', (key, value) => {
    expect(() => loadConfig({ ...REQUIRED, [key]: value })).toThrow(new RegExp(key));
  });

  it('refuses a default page size above the maximum, and accepts one equal to it', () => {
    expect(() => loadConfig({ ...REQUIRED, PROJECTS_PAGE_MAX: '5' })).toThrow(/PROJECTS_PAGE_SIZE/);
    expect(
      loadConfig({ ...REQUIRED, PROJECTS_PAGE_MAX: '5', PROJECTS_PAGE_SIZE: '5' })
        .PROJECTS_PAGE_SIZE,
    ).toBe(5);
  });

  it('refuses a non-mysql database URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@h/db' })).toThrow(/mysql:\/\//);
  });

  it('names every offending key, not only the first', () => {
    expect(() => loadConfig({ ...REQUIRED, API_PORT: '0', LOG_LEVEL: 'loud' })).toThrow(
      /API_PORT[\s\S]*LOG_LEVEL|LOG_LEVEL[\s\S]*API_PORT/,
    );
  });

  it.each(['yes', '1', 'TRUE', ''])('refuses %j as a boolean switch', (value) => {
    expect(() => loadConfig({ ...REQUIRED, API_DOCS_ENABLED: value })).toThrow(/API_DOCS_ENABLED/);
  });

  it('parses boolean switches', () => {
    expect(loadConfig({ ...REQUIRED, API_DOCS_ENABLED: 'true' }).API_DOCS_ENABLED).toBe(true);
  });

  it.each([
    ['false', false],
    ['1', 1],
    ['10', 10],
  ])('reads TRUST_PROXY=%j as %j', (value, expected) => {
    expect(loadConfig({ ...REQUIRED, TRUST_PROXY: value }).TRUST_PROXY).toBe(expected);
  });

  it('refuses TRUST_PROXY=true, which would believe a client-written header', () => {
    expect(() => loadConfig({ ...REQUIRED, TRUST_PROXY: 'true' })).not.toThrow(/from 1 to 10/);
    expect(() => loadConfig({ ...REQUIRED, TRUST_PROXY: 'true' })).toThrow(
      /TRUST_PROXY: .*"true" trusts a client-written header/,
    );
  });

  it.each(['0', '11', '1.5', 'yes', ''])('refuses TRUST_PROXY=%j', (value) => {
    expect(() => loadConfig({ ...REQUIRED, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
  });

  it.each(['64kbb', 'abc', '0kb', '64', '9mb'])('refuses body limit %j', (value) => {
    expect(() => loadConfig({ ...REQUIRED, API_BODY_LIMIT: value })).toThrow(/API_BODY_LIMIT/);
  });

  it.each(['-1', '3601', '1.5', 'soon'])('refuses migration lock timeout %j', (value) => {
    expect(() => loadConfig({ ...REQUIRED, MIGRATION_LOCK_TIMEOUT_S: value })).toThrow(
      /MIGRATION_LOCK_TIMEOUT_S/,
    );
  });

  it('names the root when the environment is not an object at all', () => {
    expect(() => loadConfig('not-an-env' as unknown as NodeJS.ProcessEnv)).toThrow(/\(root\)/);
  });

  it('requires TLS to the database in production', () => {
    expect(() => loadConfig({ ...REQUIRED, NODE_ENV: 'production' })).toThrow(/DATABASE_SSL/);
    expect(
      loadConfig({ ...REQUIRED, NODE_ENV: 'production', DATABASE_SSL: 'required' }).DATABASE_SSL,
    ).toBe('required');
  });

  describe('DATABASE_SOCKET_PATH', () => {
    const SOCKET = '/cloudsql/project:us-east1:gradfolio-db';
    const prod = { ...REQUIRED, NODE_ENV: 'production' };

    it('is unset by default', () => {
      expect(loadConfig(REQUIRED).DATABASE_SOCKET_PATH).toBeUndefined();
    });

    it('replaces TLS in production: the socket alone is accepted', () => {
      const cfg = loadConfig({ ...prod, DATABASE_SOCKET_PATH: SOCKET });
      expect(cfg).toMatchObject({ DATABASE_SOCKET_PATH: SOCKET, DATABASE_SSL: 'off' });
    });

    it('still refuses production over the network without TLS', () => {
      expect(() => loadConfig(prod)).toThrow(/DATABASE_SSL/);
    });

    it('refuses TLS together with a socket, in any environment', () => {
      for (const NODE_ENV of ['production', 'development']) {
        expect(() =>
          loadConfig({
            ...REQUIRED,
            NODE_ENV,
            DATABASE_SOCKET_PATH: SOCKET,
            DATABASE_SSL: 'required',
          }),
        ).toThrow(/DATABASE_SSL: TLS does not apply to a Unix socket/);
      }
    });

    it.each([
      ['relative', 'cloudsql/x'],
      ['whitespace', '/cloudsql/a b'],
      ['too long', `/${'a'.repeat(107)}`],
      ['too long in bytes, short in characters', `/${'é'.repeat(54)}`],
      ['empty', ''],
    ])('refuses a %s path', (_why, value) => {
      expect(() => loadConfig({ ...REQUIRED, DATABASE_SOCKET_PATH: value })).toThrow(
        /DATABASE_SOCKET_PATH/,
      );
    });
  });
});

describe('loadDatabaseConfig', () => {
  it('needs only the database settings: the migrate service has no Auth0 settings', () => {
    const cfg = loadDatabaseConfig({ DATABASE_URL });
    expect(cfg.DATABASE_URL).toBe(DATABASE_URL);
    expect(cfg).not.toHaveProperty('AUTH0_AUDIENCE');
  });

  it('still requires TLS to the database in production', () => {
    expect(() => loadDatabaseConfig({ DATABASE_URL, NODE_ENV: 'production' })).toThrow(
      /DATABASE_SSL/,
    );
  });

  it('accepts a socket in production without TLS, and refuses both together', () => {
    const SOCKET = '/cloudsql/p:r:i';
    const env = { DATABASE_URL, NODE_ENV: 'production', DATABASE_SOCKET_PATH: SOCKET };
    expect(loadDatabaseConfig(env).DATABASE_SOCKET_PATH).toBe(SOCKET);
    expect(() => loadDatabaseConfig({ ...env, DATABASE_SSL: 'required' })).toThrow(
      /TLS does not apply/,
    );
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
