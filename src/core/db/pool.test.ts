import { describe, expect, it } from 'vitest';
import { poolOptions } from './pool.js';

const base = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/gradfolio',
  DATABASE_POOL_MAX: 7,
  DATABASE_CONNECT_TIMEOUT_MS: 1234,
  DATABASE_SSL: 'off' as const,
  DATABASE_SSL_CA: undefined,
};

describe('poolOptions', () => {
  it('carries the configured limits and reads DATETIME as UTC', () => {
    expect(poolOptions(base)).toMatchObject({
      uri: base.DATABASE_URL,
      connectionLimit: 7,
      connectTimeout: 1234,
      timezone: 'Z',
      charset: 'utf8mb4_unicode_ci',
    });
  });

  it('sends no TLS options to the local container', () => {
    expect(poolOptions(base)).not.toHaveProperty('ssl');
  });

  it('verifies the server certificate when TLS is required', () => {
    expect(poolOptions({ ...base, DATABASE_SSL: 'required' }).ssl).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('pins a supplied CA', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----';
    expect(poolOptions({ ...base, DATABASE_SSL: 'required', DATABASE_SSL_CA: ca }).ssl).toEqual({
      rejectUnauthorized: true,
      ca,
    });
  });
});
