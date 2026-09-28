/**
 * The health endpoint paths, defined once.
 *
 * They appear in the controller's route decorators and in the global-prefix
 * exclusions; renaming one without the other would silently move a health
 * endpoint under `/v1`, where a platform's probe would not find it.
 */
export const LIVENESS_PATH = 'healthz';
export const READINESS_PATH = 'readyz';

export const HEALTH_PATHS = [LIVENESS_PATH, READINESS_PATH];
