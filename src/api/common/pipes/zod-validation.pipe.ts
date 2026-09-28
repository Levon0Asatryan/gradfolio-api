import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { ValidationError } from '../../../core/errors/app-error.js';

/**
 * Validates a request payload against a zod schema at the trust boundary.
 *
 * zod rather than class-validator, so the project has one schema library: the
 * environment contract uses it, and the same schemas generate openapi.yaml.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);

    if (!parsed.success) {
      // Field-level detail is safe to return: it describes the caller's own
      // input, not our internals.
      throw new ValidationError(
        parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      );
    }

    return parsed.data;
  }
}

/** `@Body(zodBody(schema))` reads better than constructing the pipe inline. */
export function zodBody<T>(schema: ZodType<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}

/** Same pipe, named for `@Query(zodQuery(schema))` call sites. */
export function zodQuery<T>(schema: ZodType<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
