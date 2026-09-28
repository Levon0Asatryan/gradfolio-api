import { createServer, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createPool } from '../db/pool.js';
import { testConfig, testDatabaseUrl } from '../../testing/database.js';
import { isDatabaseUnavailable } from './database-unavailable.js';
import { toErrorResponse } from './http-mapping.js';

/**
 * The outage table is a mapping from external signals, so it is only trusted
 * once real errors from the real driver have gone through it -- not
 * hand-built objects with a `code` property.
 */
async function queryError(url: string, connectTimeoutMs = 2000): Promise<unknown> {
  const pool = createPool({
    ...testConfig(),
    DATABASE_URL: url,
    DATABASE_CONNECT_TIMEOUT_MS: connectTimeoutMs,
  });
  try {
    await pool.query('SELECT 1');
    return undefined;
  } catch (err) {
    return err;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function withPort(url: string, port: number): string {
  const u = new URL(url);
  u.port = String(port);
  return u.toString();
}

/** A port nothing listens on: bind it, read it, close it. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('database outage classification, with real mysql2 errors', () => {
  it('a refused connection is an outage (503)', async () => {
    const url = withPort('mysql://u:p@127.0.0.1:1/db', await closedPort());
    const err = await queryError(url);

    expect(err).toBeDefined();
    expect(isDatabaseUnavailable(err)).toBe(true);
    expect(toErrorResponse(err).status).toBe(503);
  });

  it('a server that accepts and never answers is an outage (503)', async () => {
    // Accepts TCP and says nothing: mysql2 waits for the handshake until its
    // connect timeout.
    const silent: Server = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const { port } = silent.address() as { port: number };
    try {
      const err = await queryError(`mysql://u:p@127.0.0.1:${port}/db`, 500);
      expect(isDatabaseUnavailable(err)).toBe(true);
      expect(toErrorResponse(err).status).toBe(503);
    } finally {
      silent.close();
    }
  });

  it('wrong credentials are a real error, not an outage (500)', async () => {
    const url = new URL(testDatabaseUrl());
    url.password = 'definitely-wrong';
    const err = await queryError(url.toString());

    expect((err as { code?: string }).code).toBe('ER_ACCESS_DENIED_ERROR');
    expect(isDatabaseUnavailable(err)).toBe(false);
    expect(toErrorResponse(err).status).toBe(500);
  });

  it('a bad statement is a real error, not an outage (500)', async () => {
    const pool = createPool(testConfig());
    try {
      const err = await pool.query('SELECT * FROM no_such_table_here').catch((e: unknown) => e);
      expect((err as { code?: string }).code).toBe('ER_NO_SUCH_TABLE');
      expect(isDatabaseUnavailable(err)).toBe(false);
      expect(JSON.stringify(toErrorResponse(err).body)).not.toContain('no_such_table_here');
    } finally {
      await pool.end();
    }
  });
});
