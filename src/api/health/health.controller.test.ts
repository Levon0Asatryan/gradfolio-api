import { ServiceUnavailableException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import type { DbService } from '../../core/db/db.service.js';
import { testConfig } from '../../testing/database.js';
import { HealthController } from './health.controller.js';

function controller(ping: (timeoutMs: number) => Promise<void>, timeoutMs = 3000) {
  const logger = { error: vi.fn() } as unknown as PinoLogger;
  const db = { ping } as unknown as DbService;
  const cfg = testConfig({ HEALTH_TIMEOUT_MS: String(timeoutMs) });
  return { ctrl: new HealthController(db, cfg, logger), logger };
}

describe('HealthController', () => {
  it('liveness never touches the database', () => {
    const ping = vi.fn();
    expect(controller(ping).ctrl.live()).toEqual({ status: 'ok' });
    expect(ping).not.toHaveBeenCalled();
  });

  it('readiness answers ok when the database does', async () => {
    await expect(controller(() => Promise.resolve()).ctrl.ready()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
  });

  it('readiness answers 503 with a stable code, and logs the cause', async () => {
    const { ctrl, logger } = controller(() =>
      Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    );

    const err = await ctrl.ready().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toEqual({
      code: 'DATABASE_UNAVAILABLE',
      message: 'database is not reachable',
    });
    expect(logger.error).toHaveBeenCalledWith(
      { cause: 'ECONNREFUSED: connect ECONNREFUSED' },
      'readiness check failed',
    );
  });

  it('readiness hands the configured deadline to the database ping', async () => {
    const ping = vi.fn(() => Promise.resolve());
    await controller(ping, 1234).ctrl.ready();
    expect(ping).toHaveBeenCalledWith(1234);
  });
});
