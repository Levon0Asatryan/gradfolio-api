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

  /** Readiness: the process can actually serve traffic. */
  @Get(READINESS_PATH)
  async ready(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.pingWithDeadline();
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

  /**
   * Bounded by its own deadline. The pool's connect timeout bounds acquiring a
   * connection, not a query on one already open: a database that accepts
   * connections and stops answering would otherwise hold this request open.
   */
  private async pingWithDeadline(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`readiness query exceeded ${this.cfg.HEALTH_TIMEOUT_MS}ms`)),
        this.cfg.HEALTH_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([this.db.ping(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
