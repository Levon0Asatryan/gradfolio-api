import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../core/config/index.js';
import { SUGGESTIONS_PAGE_CEILING } from '../../../core/config/schema.js';
import { suggestionQuerySchema } from './suggestion.dto.js';

describe('suggestionQuerySchema limit (M7-T28)', () => {
  it('publishes the most a default deployment accepts: no 400 between the document and the service', () => {
    const cfg = loadConfig({
      DATABASE_URL: 'mysql://gradfolio:gradfolio@localhost:3306/gradfolio',
      AUTH0_ISSUER_BASE_URL: 'https://tenant.eu.auth0.com/',
      AUTH0_AUDIENCE: 'https://api.gradfolio.app',
    });
    const { limit } = suggestionQuerySchema.parse({ limit: String(SUGGESTIONS_PAGE_CEILING) });
    expect(limit).toBe(cfg.SUGGESTIONS_PAGE_MAX);
    expect(
      suggestionQuerySchema.safeParse({ limit: String(SUGGESTIONS_PAGE_CEILING + 1) }).success,
    ).toBe(false);
  });
});
