import type { LoggerService } from '@nestjs/common';
import {
  type AppConfig,
  GITHUB_SETTING_NAMES,
  unsetGithubSettings,
} from '../../core/config/index.js';

/**
 * Says at boot which GitHub connect settings are unset, by name only. With any
 * one unset every GitHub route answers 503, and nothing else says which one.
 * Logs nothing when all five are set.
 */
export function checkGithubSettings(
  logger: Pick<LoggerService, 'log' | 'warn'>,
  cfg: AppConfig,
): void {
  const missing = unsetGithubSettings(cfg);
  if (missing.length === 0) return;

  if (missing.length === GITHUB_SETTING_NAMES.length) {
    logger.log({ msg: 'GitHub connect not configured' });
    return;
  }

  logger.warn({ missing, msg: 'GitHub connect partly configured' });
}
