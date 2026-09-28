import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { APP_CONFIG } from '../../core/config/config.module.js';
import type { AppConfig } from '../../core/config/schema.js';
import { DbService } from '../../core/db/db.service.js';
import { describeError } from '../../core/errors/describe.js';
import { LIVENESS_PATH, READINESS_PATH } from './constants.js';

@Controller()
export class HealthController {
  constructor(
    private readonly db: DbService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @InjectPinoLogger(HealthController.name) private readonly logger: PinoLogger,
  ) {}

  /** Liveness: the process is running. Deliberately touches no dependency. */
  @Get(LIVENESS_PATH)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: the process can actually serve traffic.
   *
   * Bounded by HEALTH_TIMEOUT_MS in time *and* in resources: DbService.ping
   * destroys its connection at the deadline, so a stalled database cannot make
   * repeated probes pile up queries or drain the pool.
   */
  @Get(READINESS_PATH)
  async ready(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.db.ping(this.cfg.HEALTH_TIMEOUT_MS);
    } catch (err) {
      // The cause goes to the log; the unauthenticated caller gets a code.
      this.logger.error({ cause: describeError(err) }, 'readiness check failed');
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'database is not reachable',
      });
    }
    return { status: 'ok', database: 'ok' };
  }
}
