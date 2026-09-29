import type { z } from 'zod';
import type { JsonText } from './column-types.js';

/**
 * The only way to produce a value for a JSON column: parses `value` with the
 * column's schema (throwing on a wrong shape) and serializes what the schema
 * returned, trimmed and normalized.
 *
 * Also why it is a string: mysql2 expands an array parameter into a list, so
 * an array passed as-is fails with ER_WRONG_VALUE_COUNT_ON_ROW (1136; run).
 */
export function toJsonColumn<S extends z.ZodType>(
  schema: S,
  value: unknown,
): JsonText<z.output<S>> {
  return JSON.stringify(schema.parse(value)) as JsonText<z.output<S>>;
}
