import { SetMetadata } from '@nestjs/common';
import { RATE_BUDGET, type RateBudgetName } from '../rate-limit.constants.js';

/**
 * Puts a route under a named budget (RATE_LIMIT_SEARCH, _IMPORT, _AI) in
 * addition to the default one. One budget per route: an expensive endpoint
 * never shares another's.
 */
export const RateBudget = (name: RateBudgetName): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_BUDGET, name);
