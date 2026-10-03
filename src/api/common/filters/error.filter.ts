import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { toErrorResponse } from '../../../core/errors/http-mapping.js';
import { requestUrlPath } from '../../../core/logging/index.js';

/**
 * Turns every thrown value into the same response shape. A thin adapter over
 * toErrorResponse(), which holds the mapping logic and is tested directly.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(@InjectPinoLogger(ErrorFilter.name) private readonly logger: PinoLogger) {}

  catch(err: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    const { status, body, logDetail, isServerFault, headers } = toErrorResponse(err);

    const fields = {
      status,
      code: body.code,
      method: req.method,
      // Path only: the query string can carry search terms or OAuth codes.
      path: requestUrlPath(req.url),
      cause: logDetail,
    };

    // Our fault or theirs decides the level: a 404 is not an incident, a 500
    // is. Neither is dropped.
    if (isServerFault) {
      this.logger.error(fields, 'request failed');
    } else {
      this.logger.warn(fields, 'request rejected');
    }

    for (const [name, value] of Object.entries(headers ?? {})) res.setHeader(name, value);
    res.status(status).json(body);
  }
}
