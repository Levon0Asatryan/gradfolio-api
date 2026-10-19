import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../core/config/index.js';
import { checkGithubSettings } from './github-settings-check.js';

const DATABASE_URL = 'mysql://gradfolio:gradfolio@localhost:3306/gradfolio';
const AUTH = {
  AUTH0_ISSUER_BASE_URL: 'https://tenant.eu.auth0.com/',
  AUTH0_AUDIENCE: 'https://api.gradfolio.app',
};
const SECRETS = {
  AUTH0_CLIENT_ID: 'spa-client-value',
  AUTH0_M2M_CLIENT_ID: 'm2m-client-value',
  AUTH0_M2M_CLIENT_SECRET: 'm2m-secret-value',
  GITHUB_CLIENT_ID: 'gh-client-value',
  GITHUB_CLIENT_SECRET: 'gh-secret-value',
};

function run(env: Record<string, string | undefined>) {
  const logger = { log: vi.fn(), warn: vi.fn() };
  checkGithubSettings(logger, loadConfig({ DATABASE_URL, ...AUTH, ...env }));
  return logger;
}

describe('checkGithubSettings', () => {
  it('logs nothing when all five settings are set', () => {
    const logger = run(SECRETS);
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs one info line when none is set', () => {
    const logger = run({});
    expect(logger.log).toHaveBeenCalledOnce();
    expect(logger.log).toHaveBeenCalledWith({ msg: 'GitHub connect not configured' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns once, naming every unset setting, when some are set', () => {
    const logger = run({
      ...SECRETS,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    });
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith({
      missing: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
      msg: 'GitHub connect partly configured',
    });
  });

  it('names the one setting that is unset, and no other', () => {
    const logger = run({ ...SECRETS, AUTH0_CLIENT_ID: undefined });
    expect(logger.warn).toHaveBeenCalledWith({
      missing: ['AUTH0_CLIENT_ID'],
      msg: 'GitHub connect partly configured',
    });
  });

  it('never logs the value of any setting', () => {
    const logger = run({
      ...SECRETS,
      GITHUB_CLIENT_ID: undefined,
      GITHUB_CLIENT_SECRET: undefined,
    });
    const logged = JSON.stringify([logger.log.mock.calls, logger.warn.mock.calls]);
    for (const value of Object.values(SECRETS)) {
      expect(logged).not.toContain(value);
    }
  });
});
