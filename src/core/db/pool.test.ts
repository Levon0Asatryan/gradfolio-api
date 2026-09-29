import { describe, expect, it } from 'vitest';
import { castTinyIntBoolean, poolOptions } from './pool.js';

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
      typeCast: castTinyIntBoolean,
      dateStrings: ['DATE'],
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

describe('castTinyIntBoolean', () => {
  const field = (type: string, length: number, value: string | null) =>
    ({ type, length, string: () => value }) as unknown as Parameters<typeof castTinyIntBoolean>[0];
  const next = () => 'next';

  it.each([
    ['1', true],
    ['0', false],
    [null, null],
  ])('reads TINYINT(1) %j as %j', (value, expected) => {
    expect(castTinyIntBoolean(field('TINY', 1, value), next)).toBe(expected);
  });

  it('leaves every other column to the driver', () => {
    expect(castTinyIntBoolean(field('TINY', 4, '7'), next)).toBe('next');
    expect(castTinyIntBoolean(field('LONG', 1, '1'), next)).toBe('next');
  });
});
