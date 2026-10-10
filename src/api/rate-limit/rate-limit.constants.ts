/** Named budgets a route opts into with @RateBudget, on top of the default. */
export const RATE_BUDGETS = ['search', 'import', 'ai', 'upload', 'lookup', 'browse'] as const;
export type RateBudgetName = (typeof RATE_BUDGETS)[number];

/** Route metadata set by @RateBudget(). */
export const RATE_BUDGET = 'gradfolio:rateBudget';
