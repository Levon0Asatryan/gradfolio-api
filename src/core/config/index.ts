import type { ZodType } from 'zod';
import {
  type AppConfig,
  configSchema,
  type DatabaseConfig,
  databaseConfigSchema,
} from './schema.js';

export type { AppConfig, DatabaseConfig } from './schema.js';
export { configSchema, databaseConfigSchema, parseByteSize } from './schema.js';

function parse<T>(schema: ZodType<T>, env: NodeJS.ProcessEnv): T {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Deliberately not a logger call: this runs before the logger exists.
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}

/**
 * Parses and validates the environment for the api process.
 *
 * Called as the entrypoint's first statement so an invalid value stops the
 * process at boot, and again by ConfigModule to provide the value through
 * dependency injection. It is pure, so the two calls agree.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return parse(configSchema, env);
}

/** The subset the database tools (migrate, seed, schema dump) need. */
export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return parse(databaseConfigSchema, env);
}
