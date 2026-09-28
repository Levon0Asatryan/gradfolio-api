import { type AppConfig, configSchema } from './schema.js';

export type { AppConfig } from './schema.js';
export { configSchema, parseByteSize } from './schema.js';

/**
 * Parses and validates the environment.
 *
 * Called as the entrypoint's first statement so an invalid value stops the
 * process at boot, and again by ConfigModule to provide the value through
 * dependency injection. It is pure, so the two calls agree.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // Deliberately not a logger call: this runs before the logger exists.
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}
